/**
 * MusicBrainz API service.
 *
 * Provides helpers to resolve an artist MBID (MusicBrainz ID) by name and to
 * fetch a Wikipedia-sourced biography for a given MBID.
 *
 * Rate-limit note: MusicBrainz enforces a maximum of ~1 request per second.
 * These functions are typically called once per artist detail view, so no
 * client-side throttle is implemented here. If usage increases, add a rate
 * limiter (e.g. a simple delay queue).
 */

const API_BASE_URL = 'https://musicbrainz.org/ws/2/';
const WEB_BASE_URL = 'https://musicbrainz.org/artist/';
const WIKIDATA_API_URL = 'https://www.wikidata.org/w/api.php';
const WIKIPEDIA_API_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
// MusicBrainz asks every client to identify itself with name, version, and a
// contact URL or email in the User-Agent. Generic UAs get rate-limited more
// aggressively. Version is read from package.json at build time via Expo's
// asset pipeline (the `version` field of app.json mirrors package.json).
// Repo URL is the contact point — no personal email.
import pkg from '../../package.json';
const USER_AGENT = `Substreamer/${pkg.version} (+https://github.com/ghenry22/substreamer)`;

/**
 * Escape characters with special meaning in MusicBrainz's Lucene-based search
 * query syntax. Required for artist / album names containing any of:
 *
 *   + - && || ! ( ) { } [ ] ^ " ~ * ? : \ /
 *
 * Without escaping, names like "AC/DC", "P!nk", "Sigur Rós" (no specials —
 * fine), "blink-182" (`-` is the NOT operator), "Death Cab for Cutie"
 * (parens not present here but common elsewhere) silently produce empty or
 * wrong matches. We escape each special with a leading backslash.
 *
 * Lucene also treats `&&` and `||` as boolean operators, so we double-escape
 * a single `&` or `|` defensively.
 */
export function escapeLuceneQuery(s: string): string {
  return s.replace(/([+\-!(){}[\]^"~*?:\\/&|])/g, '\\$1');
}

/**
 * MB's rate limit is ~1 req/sec. When we get rate-limited we just back off
 * for slightly over that window and try once more before giving up. Most
 * "missing bio" cases caused by a 503/429 in a burst lookup recover here.
 *
 * Module-mutable so tests can drive the backoff to 0 without faking
 * timers across every dependent test. Not exported in the production
 * surface — callers set it via `__setRetryBackoffForTests`.
 */
let retryBackoffMs = 1100;

/** Test-only: override the retry backoff so 503/429 tests don't spend
 *  1.1s in real time waiting for the next attempt. */
export function __setRetryBackoffForTests(ms: number): void {
  retryBackoffMs = ms;
}

/**
 * Standard fetch wrapped with a single retry on transient errors. Retries
 * 429 (rate-limited), 503 (service unavailable), and network/transport
 * throws. Anything else (404, 400, success) returns immediately.
 *
 * Honors AbortSignal: if the signal aborts mid-backoff we re-throw the
 * abort error rather than retrying.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const isTransient = (status: number) => status === 429 || status === 503;
  const signal = init.signal ?? undefined;

  let firstAttempt: Response | undefined;
  try {
    firstAttempt = await fetch(url, init);
    if (!isTransient(firstAttempt.status)) return firstAttempt;
  } catch (e) {
    // Network / DNS / TLS — drop into backoff and retry once.
    if (signal?.aborted) throw e;
  }

  // Wait the rate-limit window, honoring abort.
  if (retryBackoffMs > 0) {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, retryBackoffMs);
      if (signal) {
        const onAbort = () => {
          clearTimeout(t);
          reject(signal.reason ?? new Error('aborted'));
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  return fetch(url, init);
}

// ── Types ───────────────────────────────────────────────────────────────────

/** Shape of a single artist entry returned by the MusicBrainz search API. */
export interface MusicBrainzArtist {
  id: string;
  name: string;
  score?: number;
  type?: string;
  country?: string;
  disambiguation?: string;
}

/** Top-level response from the MusicBrainz artist search endpoint. */
export interface MusicBrainzArtistSearchResult {
  created: string;
  count: number;
  offset: number;
  artists: MusicBrainzArtist[];
}

/** Shape of the Wikipedia extract object returned by MusicBrainz. */
export interface WikipediaExtract {
  canonical?: string;
  title?: string;
  content?: string;
  language?: string;
  url?: string;
}

/** Response from the MusicBrainz Wikipedia extract endpoint. */
interface WikipediaExtractResponse {
  wikipediaExtract?: WikipediaExtract;
}

// ── Functions ───────────────────────────────────────────────────────────────

/**
 * Search for an artist by name and return the best-matching MBID.
 *
 * Uses the MusicBrainz search API with `limit=1` to retrieve the single
 * highest-scoring match.
 *
 * @param artistName  The artist name to search for.
 * @returns The MBID string, or `null` if no match is found or an error occurs.
 */
/** Minimum MB search score for an artist match to be considered. MB scores
 *  the lexical match 0-100; anything below ~90 is almost always a different
 *  artist that happens to share words with the query. */
const MIN_ARTIST_SEARCH_SCORE = 90;

/** Artist `type` values that suggest a real music act. We don't strictly
 *  require this — some real artists are recorded as `Other` or blank — but
 *  it's used as a tiebreaker when two candidates tie on score. */
const PREFERRED_ARTIST_TYPES = new Set(['Group', 'Person', 'Orchestra', 'Choir']);

export async function searchArtistMBID(
  artistName: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const query = `artist:${escapeLuceneQuery(artistName)}`;
    // Pull a small batch so we can score-gate and prefer real music acts
    // over high-scoring lookalikes (different artist, label, character name,
    // etc.) that match the query string but aren't who we want.
    const url = `${API_BASE_URL}artist/?query=${encodeURIComponent(query)}&fmt=json&limit=5`;

    const response = await fetchWithRetry(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      signal,
    });

    if (!response.ok) return null;

    const data: MusicBrainzArtistSearchResult = await response.json();
    const candidates = data.artists ?? [];
    if (candidates.length === 0) return null;

    // Filter to score-gated matches and rank: highest score first, ties
    // broken by preferred-type membership.
    const ranked = candidates
      .filter((a) => (a.score ?? 0) >= MIN_ARTIST_SEARCH_SCORE)
      .sort((a, b) => {
        const scoreDelta = (b.score ?? 0) - (a.score ?? 0);
        if (scoreDelta !== 0) return scoreDelta;
        const aPreferred = a.type && PREFERRED_ARTIST_TYPES.has(a.type) ? 1 : 0;
        const bPreferred = b.type && PREFERRED_ARTIST_TYPES.has(b.type) ? 1 : 0;
        return bPreferred - aPreferred;
      });

    return ranked[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Search for artists by name and return multiple results for user selection.
 *
 * @param query  The artist name / search query.
 * @param limit  Maximum number of results (default 10).
 * @returns Array of matching artists, or empty array on failure.
 */
export async function searchArtists(
  query: string,
  limit = 10,
  signal?: AbortSignal,
): Promise<MusicBrainzArtist[]> {
  try {
    const url = `${API_BASE_URL}artist/?query=${encodeURIComponent(`artist:${escapeLuceneQuery(query)}`)}&fmt=json&limit=${limit}`;

    const response = await fetchWithRetry(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      signal,
    });

    if (!response.ok) return [];

    const data: MusicBrainzArtistSearchResult = await response.json();

    return data.artists ?? [];
  } catch {
    return [];
  }
}

/**
 * Fetch the Wikidata Q-number for an artist via MB's url-rels. Mirrors
 * `getWikidataIdForReleaseGroup` for the artist side. Used as the entry
 * to the Wikipedia REST fallback when MB's `/wikipedia-extract` comes
 * back empty (which happens often — the MB→Wikidata→Wikipedia link
 * table is more complete than the embedded extract).
 */
export async function getWikidataIdForArtist(
  mbid: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const url = `${API_BASE_URL}artist/${encodeURIComponent(mbid)}?inc=url-rels&fmt=json`;
    const response = await fetchWithRetry(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal,
    });
    if (!response.ok) return null;
    const data: MusicBrainzReleaseGroupWithRels = await response.json();
    const wikidataRel = data.relations?.find((r) => r.type === 'wikidata');
    if (!wikidataRel?.url?.resource) return null;
    // Extract Q-number from URL like "https://www.wikidata.org/wiki/Q40404"
    const match = wikidataRel.url.resource.match(/\/(Q\d+)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Fetch the biography for an artist by their MBID.
 *
 * Two-stage lookup:
 *   1. MB's `/wikipedia-extract` scraping endpoint — fastest path when it
 *      works. Returns a plain-text Wikipedia summary.
 *   2. Fallback: MB url-rels → Wikidata Q-number → Wikipedia REST API.
 *      Catches the common case where the Wikipedia article exists but the
 *      embedded extract is missing.
 *
 * @returns The biography text, or `null` if unavailable from both sources.
 */
export async function getArtistBiography(
  mbid: string,
  signal?: AbortSignal,
): Promise<string | null> {
  // Stage 1: MB's wikipedia-extract scrape.
  try {
    const url = encodeURI(`${WEB_BASE_URL}${mbid}/wikipedia-extract`);
    const response = await fetchWithRetry(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal,
    });
    if (response.ok) {
      const data: WikipediaExtractResponse = await response.json();
      const content = data.wikipediaExtract?.content?.trim();
      if (content) return content;
    }
  } catch { /* fall through to Wikidata stage */ }

  // Stage 2: MB → Wikidata → Wikipedia REST. `getWikipediaExtractForAlbum`
  // is named for the album path that introduced it, but its body is
  // entity-agnostic: it just resolves a Wikidata Q-number to a Wikipedia
  // article summary, so it's reusable for artists too.
  try {
    const wikidataId = await getWikidataIdForArtist(mbid, signal);
    if (!wikidataId) return null;
    const result = await getWikipediaExtractForAlbum(wikidataId, signal);
    return result?.extract ?? null;
  } catch {
    return null;
  }
}

// ── Album description enrichment ──────────────────────────────────────────
//
// MusicBrainz's /wikipedia-extract endpoint only works for artists, not
// release-groups. For albums we follow a multi-step pipeline:
//   1. Search MusicBrainz for the release-group MBID (or use one provided)
//   2. Fetch url-rels for the release-group → extract Wikidata Q-number
//   3. Query Wikidata sitelinks → resolve English Wikipedia article title
//   4. Fetch the article extract via the Wikipedia REST API

/** Shape of a release-group entry returned by the MusicBrainz search API. */
export interface MusicBrainzReleaseGroup {
  id: string;
  title: string;
  score?: number;
  'primary-type'?: string;
  'first-release-date'?: string;
  'artist-credit'?: Array<{ name: string; artist: { id: string; name: string } }>;
}

/** Top-level response from the MusicBrainz release-group search endpoint. */
interface MusicBrainzReleaseGroupSearchResult {
  'release-groups'?: MusicBrainzReleaseGroup[];
}

/** A URL relation returned by the MusicBrainz API. */
interface MusicBrainzUrlRelation {
  type: string;
  url?: { resource: string };
}

/** Shape of a release-group lookup with url-rels. */
interface MusicBrainzReleaseGroupWithRels {
  id: string;
  relations?: MusicBrainzUrlRelation[];
}

/**
 * Search MusicBrainz for a release-group matching an artist + album name.
 *
 * @returns The best-matching release-group MBID, or `null`.
 */
export async function searchReleaseGroupMBID(
  artist: string,
  album: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const query = `releasegroup:${escapeLuceneQuery(album)} AND artist:${escapeLuceneQuery(artist)}`;
    const url = `${API_BASE_URL}release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=1`;

    const response = await fetchWithRetry(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal,
    });

    if (!response.ok) return null;

    const data: MusicBrainzReleaseGroupSearchResult = await response.json();
    const groups = data['release-groups'];
    return groups && groups.length > 0 ? groups[0].id : null;
  } catch {
    return null;
  }
}

/**
 * Search for release-groups and return multiple results for user selection.
 *
 * @param query   The album name / search query.
 * @param artist  Optional artist name to narrow results.
 * @param limit   Maximum number of results (default 10).
 * @returns Array of matching release-groups, or empty array on failure.
 */
export async function searchReleaseGroups(
  query: string,
  artist?: string,
  limit = 10,
  signal?: AbortSignal,
): Promise<MusicBrainzReleaseGroup[]> {
  try {
    const parts = [`releasegroup:${escapeLuceneQuery(query)}`];
    if (artist) parts.push(`AND artist:${escapeLuceneQuery(artist)}`);
    const url = `${API_BASE_URL}release-group/?query=${encodeURIComponent(parts.join(' '))}&fmt=json&limit=${limit}`;

    const response = await fetchWithRetry(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal,
    });

    if (!response.ok) return [];

    const data: MusicBrainzReleaseGroupSearchResult = await response.json();
    return data['release-groups'] ?? [];
  } catch {
    return [];
  }
}

/**
 * Resolve a release MBID to its parent release-group MBID.
 *
 * Subsonic servers (e.g. Navidrome) return release MBIDs, not release-group
 * MBIDs. This function looks up the release and extracts the release-group ID,
 * which is needed for the Wikidata → Wikipedia pipeline.
 *
 * @param releaseMbid  The MusicBrainz release ID.
 * @returns The release-group MBID, or `null`.
 */
export async function getReleaseGroupIdForRelease(
  releaseMbid: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const url = `${API_BASE_URL}release/${encodeURIComponent(releaseMbid)}?inc=release-groups&fmt=json`;

    const response = await fetchWithRetry(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal,
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data?.['release-group']?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch the Wikidata Q-number for a release-group via its URL relationships.
 *
 * @param mbid  The MusicBrainz release-group ID.
 * @returns The Wikidata Q-number (e.g. "Q202996"), or `null`.
 */
export async function getWikidataIdForReleaseGroup(
  mbid: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const url = `${API_BASE_URL}release-group/${encodeURIComponent(mbid)}?inc=url-rels&fmt=json`;

    const response = await fetchWithRetry(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal,
    });

    if (!response.ok) return null;

    const data: MusicBrainzReleaseGroupWithRels = await response.json();
    const wikidataRel = data.relations?.find((r) => r.type === 'wikidata');
    if (!wikidataRel?.url?.resource) return null;

    // Extract Q-number from URL like "https://www.wikidata.org/wiki/Q202996"
    const match = wikidataRel.url.resource.match(/\/(Q\d+)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a Wikidata entity to a Wikipedia article extract.
 *
 * Uses the Wikidata sitelinks API to find the English Wikipedia article title,
 * then fetches the article summary via the Wikipedia REST API.
 *
 * @param wikidataId  The Wikidata Q-number (e.g. "Q202996").
 * @returns An object with `extract` (plain text) and `url` (Wikipedia page), or `null`.
 */
export async function getWikipediaExtractForAlbum(
  wikidataId: string,
  signal?: AbortSignal,
): Promise<{ extract: string; url: string } | null> {
  try {
    // Step 1: Resolve Wikipedia article title via Wikidata sitelinks
    const wdUrl =
      `${WIKIDATA_API_URL}?action=wbgetentities&format=json&props=sitelinks/urls` +
      `&ids=${encodeURIComponent(wikidataId)}&sitefilter=enwiki`;

    const wdResponse = await fetchWithRetry(wdUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal,
    });

    if (!wdResponse.ok) return null;

    const wdData = await wdResponse.json();
    const entity = wdData?.entities?.[wikidataId];
    const enwiki = entity?.sitelinks?.enwiki;
    if (!enwiki?.title) return null;

    // Step 2: Fetch article extract from Wikipedia REST API
    const wpUrl = `${WIKIPEDIA_API_URL}${encodeURIComponent(enwiki.title)}`;

    const wpResponse = await fetchWithRetry(wpUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal,
    });

    if (!wpResponse.ok) return null;

    const wpData = await wpResponse.json();
    const extract = wpData?.extract?.trim();
    if (!extract) return null;

    const articleUrl =
      wpData?.content_urls?.desktop?.page ??
      `https://en.wikipedia.org/wiki/${encodeURIComponent(enwiki.title)}`;

    return { extract, url: articleUrl };
  } catch {
    return null;
  }
}

/**
 * Fetch an album description from Wikipedia via MusicBrainz + Wikidata.
 *
 * This is the main entry point for album description enrichment. It chains
 * the MusicBrainz → Wikidata → Wikipedia pipeline and returns a plain-text
 * description with a source URL for attribution.
 *
 * @param artist            The artist name (used for MusicBrainz search if no MBID).
 * @param album             The album name (used for MusicBrainz search if no MBID).
 * @param mbid              Optional MusicBrainz ID (release or release-group).
 * @param isReleaseGroupId  If true, `mbid` is already a release-group ID (e.g. from
 *                          an MBID override). If false/omitted, it's treated as a
 *                          release ID and resolved to its parent release-group.
 * @returns An object with `description` and `url`, or `null`.
 */
export async function getAlbumDescription(
  artist: string,
  album: string,
  mbid?: string | null,
  isReleaseGroupId?: boolean,
  signal?: AbortSignal,
): Promise<{ description: string; url: string } | null> {
  try {
    let releaseGroupId: string | null = null;

    if (mbid) {
      if (isReleaseGroupId) {
        // Override MBIDs from searchReleaseGroups are already release-group IDs
        releaseGroupId = mbid;
      } else {
        // Server-provided MBIDs are release IDs — resolve to release-group
        releaseGroupId = await getReleaseGroupIdForRelease(mbid, signal);
      }
    }

    // Fall back to searching by artist + album name
    if (!releaseGroupId) {
      releaseGroupId = await searchReleaseGroupMBID(artist, album, signal);
    }

    if (!releaseGroupId) return null;

    const wikidataId = await getWikidataIdForReleaseGroup(releaseGroupId, signal);
    if (!wikidataId) return null;

    const result = await getWikipediaExtractForAlbum(wikidataId, signal);
    if (!result) return null;

    return { description: result.extract, url: result.url };
  } catch {
    return null;
  }
}
