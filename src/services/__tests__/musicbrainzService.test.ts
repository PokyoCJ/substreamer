const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

import {
  __setRetryBackoffForTests,
  escapeLuceneQuery,
  getArtistBiography,
  getAlbumDescription,
  getReleaseGroupIdForRelease,
  getWikidataIdForArtist,
  getWikidataIdForReleaseGroup,
  getWikipediaExtractForAlbum,
  searchArtistMBID,
  searchArtists,
  searchReleaseGroupMBID,
  searchReleaseGroups,
} from '../musicbrainzService';

beforeEach(() => {
  mockFetch.mockReset();
  // Skip the real-time backoff so 503/429 retry tests don't spend 1.1s in
  // real time each. The retry logic itself is exercised separately in the
  // fetchWithRetry suite.
  __setRetryBackoffForTests(0);
});

describe('searchArtistMBID', () => {
  it('returns the MBID of the top-scored matching artist', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        artists: [{ id: 'mbid-123', name: 'Radiohead', score: 100, type: 'Group' }],
      }),
    });
    const result = await searchArtistMBID('Radiohead');
    expect(result).toBe('mbid-123');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('artist%3ARadiohead');
    // Now pulls 5 candidates so we can score-gate and tie-break by type.
    expect(url).toContain('limit=5');
  });

  it('rejects candidates below the MIN_ARTIST_SEARCH_SCORE threshold', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        artists: [
          { id: 'mbid-low', name: 'Maybe Radio', score: 55, type: 'Group' },
          { id: 'mbid-also-low', name: 'Radio Co.', score: 70, type: 'Group' },
        ],
      }),
    });
    // Highest score is 70 — still below 90, so we discard everything.
    expect(await searchArtistMBID('Radiohead')).toBeNull();
  });

  it('prefers Group/Person type when two candidates tie on score', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        artists: [
          { id: 'mbid-character', name: 'Radiohead', score: 95, type: 'Character' },
          { id: 'mbid-band',      name: 'Radiohead', score: 95, type: 'Group' },
        ],
      }),
    });
    expect(await searchArtistMBID('Radiohead')).toBe('mbid-band');
  });

  it('lucene-escapes special characters in the name', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ artists: [] }),
    });
    await searchArtistMBID('AC/DC');
    const url = mockFetch.mock.calls[0][0] as string;
    // `/` is a Lucene special; should appear as `\/` after escape, which
    // URL-encodes to `%5C%2F`.
    expect(url).toContain('%5C%2F');
  });

  it('returns null when no artists match', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ artists: [] }),
    });
    expect(await searchArtistMBID('nonexistent')).toBeNull();
  });

  it('returns null when artists field is undefined', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    expect(await searchArtistMBID('nobody')).toBeNull();
  });

  it('returns null on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });
    expect(await searchArtistMBID('Radiohead')).toBeNull();
  });

  it('returns null on fetch error', async () => {
    mockFetch.mockRejectedValue(new Error('network'));
    expect(await searchArtistMBID('Radiohead')).toBeNull();
  });
});

describe('searchArtists', () => {
  it('returns an array of matching artists', async () => {
    const artists = [
      { id: 'a1', name: 'Radiohead', score: 100 },
      { id: 'a2', name: 'Radio Dept.', score: 80 },
    ];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ artists }),
    });
    const result = await searchArtists('Radio');
    expect(result).toEqual(artists);
  });

  it('respects custom limit parameter', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ artists: [] }),
    });
    await searchArtists('Test', 5);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('limit=5');
  });

  it('returns empty array on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    expect(await searchArtists('Radiohead')).toEqual([]);
  });

  it('returns empty array on fetch error', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'));
    expect(await searchArtists('Radiohead')).toEqual([]);
  });

  it('returns empty array when artists field is missing', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    expect(await searchArtists('nobody')).toEqual([]);
  });
});

describe('getArtistBiography', () => {
  it('returns trimmed biography content', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        wikipediaExtract: { content: '  A famous band.  ' },
      }),
    });
    expect(await getArtistBiography('mbid-1')).toBe('A famous band.');
  });

  it('returns null when wikipediaExtract is missing', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    expect(await getArtistBiography('mbid-1')).toBeNull();
  });

  it('returns null when MB content is empty and no Wikidata fallback resolves', async () => {
    // Stage 1: MB returns whitespace-only content (treated as missing).
    // Stage 2: artist url-rels lookup returns no wikidata relation.
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ wikipediaExtract: { content: '   ' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'mbid-1', relations: [] }),
      });
    expect(await getArtistBiography('mbid-1')).toBeNull();
  });

  it('falls back to Wikipedia REST when MB extract is empty but Wikidata link exists', async () => {
    // Stage 1: MB returns nothing.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    // Stage 2a: artist url-rels has a wikidata relation.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'mbid-1',
        relations: [
          { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q42' } },
        ],
      }),
    });
    // Stage 2b: Wikidata sitelinks resolves enwiki title.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        entities: {
          Q42: { sitelinks: { enwiki: { title: 'Real_Artist' } } },
        },
      }),
    });
    // Stage 2c: Wikipedia REST returns the extract.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        extract: 'Real Artist is a band from somewhere.',
        content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Real_Artist' } },
      }),
    });

    expect(await getArtistBiography('mbid-1')).toBe('Real Artist is a band from somewhere.');
  });

  it('returns null on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    expect(await getArtistBiography('mbid-1')).toBeNull();
  });

  it('returns null on fetch error', async () => {
    mockFetch.mockRejectedValue(new Error('network'));
    expect(await getArtistBiography('mbid-1')).toBeNull();
  });

  it('includes MBID in the URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ wikipediaExtract: { content: 'Bio' } }),
    });
    await getArtistBiography('abc-def-123');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('abc-def-123');
    expect(url).toContain('wikipedia-extract');
  });
});

// ── Album description enrichment ──────────────────────────────────────

describe('searchReleaseGroupMBID', () => {
  it('returns the MBID of the first matching release-group', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        'release-groups': [{ id: 'rg-123', title: 'OK Computer', score: 100 }],
      }),
    });
    const result = await searchReleaseGroupMBID('Radiohead', 'OK Computer');
    expect(result).toBe('rg-123');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('release-group');
    expect(url).toContain('limit=1');
  });

  it('returns null when no release-groups match', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ 'release-groups': [] }),
    });
    expect(await searchReleaseGroupMBID('Nobody', 'Nothing')).toBeNull();
  });

  it('returns null when release-groups field is missing', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    expect(await searchReleaseGroupMBID('A', 'B')).toBeNull();
  });

  it('returns null on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });
    expect(await searchReleaseGroupMBID('A', 'B')).toBeNull();
  });

  it('returns null on fetch error', async () => {
    mockFetch.mockRejectedValue(new Error('network'));
    expect(await searchReleaseGroupMBID('A', 'B')).toBeNull();
  });
});

describe('searchReleaseGroups', () => {
  it('returns multiple release-group results', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        'release-groups': [
          { id: 'rg-1', title: 'OK Computer', score: 100, 'primary-type': 'Album' },
          { id: 'rg-2', title: 'OK Computer OKNOTOK', score: 80, 'primary-type': 'Album' },
        ],
      }),
    });
    const results = await searchReleaseGroups('OK Computer', 'Radiohead');
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('rg-1');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('release-group');
    expect(url).toContain('artist%3ARadiohead');
  });

  it('searches without artist when not provided', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ 'release-groups': [{ id: 'rg-1', title: 'Test' }] }),
    });
    const results = await searchReleaseGroups('Test');
    expect(results).toHaveLength(1);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).not.toContain('artist%3A');
  });

  it('respects custom limit', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ 'release-groups': [] }),
    });
    await searchReleaseGroups('Test', undefined, 5);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('limit=5');
  });

  it('returns empty array on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });
    expect(await searchReleaseGroups('Test')).toEqual([]);
  });

  it('returns empty array on fetch error', async () => {
    mockFetch.mockRejectedValue(new Error('network'));
    expect(await searchReleaseGroups('Test')).toEqual([]);
  });

  it('returns empty array when release-groups field is missing', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    expect(await searchReleaseGroups('Test')).toEqual([]);
  });
});

describe('getReleaseGroupIdForRelease', () => {
  it('returns the release-group ID from a release lookup', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'release-123',
        'release-group': { id: 'rg-456', title: 'Album' },
      }),
    });
    expect(await getReleaseGroupIdForRelease('release-123')).toBe('rg-456');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('release/release-123');
    expect(url).toContain('inc=release-groups');
  });

  it('returns null when release-group field is missing', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'release-123' }),
    });
    expect(await getReleaseGroupIdForRelease('release-123')).toBeNull();
  });

  it('returns null on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    expect(await getReleaseGroupIdForRelease('bad-id')).toBeNull();
  });

  it('returns null on fetch error', async () => {
    mockFetch.mockRejectedValue(new Error('network'));
    expect(await getReleaseGroupIdForRelease('release-123')).toBeNull();
  });
});

describe('getWikidataIdForReleaseGroup', () => {
  it('extracts Q-number from wikidata url relation', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'rg-123',
        relations: [
          { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q202996' } },
          { type: 'discogs', url: { resource: 'https://discogs.com/123' } },
        ],
      }),
    });
    expect(await getWikidataIdForReleaseGroup('rg-123')).toBe('Q202996');
  });

  it('returns null when no wikidata relation exists', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'rg-123',
        relations: [{ type: 'discogs', url: { resource: 'https://discogs.com/123' } }],
      }),
    });
    expect(await getWikidataIdForReleaseGroup('rg-123')).toBeNull();
  });

  it('returns null when relations array is empty', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'rg-123', relations: [] }),
    });
    expect(await getWikidataIdForReleaseGroup('rg-123')).toBeNull();
  });

  it('returns null when relations field is missing', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'rg-123' }),
    });
    expect(await getWikidataIdForReleaseGroup('rg-123')).toBeNull();
  });

  it('returns null on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    expect(await getWikidataIdForReleaseGroup('rg-123')).toBeNull();
  });

  it('returns null on fetch error', async () => {
    mockFetch.mockRejectedValue(new Error('network'));
    expect(await getWikidataIdForReleaseGroup('rg-123')).toBeNull();
  });

  it('returns null when wikidata URL has no Q-number', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'rg-123',
        relations: [{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Property:P1234' } }],
      }),
    });
    expect(await getWikidataIdForReleaseGroup('rg-123')).toBeNull();
  });
});

describe('getWikipediaExtractForAlbum', () => {
  it('resolves Wikidata → Wikipedia article extract', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entities: {
            Q202996: {
              sitelinks: {
                enwiki: { title: 'OK Computer', url: 'https://en.wikipedia.org/wiki/OK_Computer' },
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          extract: 'OK Computer is the third studio album by Radiohead.',
          content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/OK_Computer' } },
        }),
      });

    const result = await getWikipediaExtractForAlbum('Q202996');
    expect(result).toEqual({
      extract: 'OK Computer is the third studio album by Radiohead.',
      url: 'https://en.wikipedia.org/wiki/OK_Computer',
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns null when no enwiki sitelink exists', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        entities: { Q999: { sitelinks: {} } },
      }),
    });
    expect(await getWikipediaExtractForAlbum('Q999')).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null when Wikipedia extract is empty', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entities: {
            Q123: { sitelinks: { enwiki: { title: 'Something' } } },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ extract: '' }),
      });
    expect(await getWikipediaExtractForAlbum('Q123')).toBeNull();
  });

  it('returns null when Wikidata fetch fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    expect(await getWikipediaExtractForAlbum('Q123')).toBeNull();
  });

  it('returns null when Wikipedia fetch fails', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entities: {
            Q123: { sitelinks: { enwiki: { title: 'Something' } } },
          },
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 404 });
    expect(await getWikipediaExtractForAlbum('Q123')).toBeNull();
  });

  it('returns null on fetch error', async () => {
    mockFetch.mockRejectedValue(new Error('network'));
    expect(await getWikipediaExtractForAlbum('Q123')).toBeNull();
  });

  it('constructs fallback URL when content_urls is missing', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entities: {
            Q123: { sitelinks: { enwiki: { title: 'My Album' } } },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          extract: 'Album description.',
        }),
      });
    const result = await getWikipediaExtractForAlbum('Q123');
    expect(result?.url).toBe('https://en.wikipedia.org/wiki/My%20Album');
  });
});

describe('getAlbumDescription', () => {
  it('resolves release MBID → release-group → Wikipedia', async () => {
    // getReleaseGroupIdForRelease
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'release-1',
        'release-group': { id: 'rg-1' },
      }),
    });
    // getWikidataIdForReleaseGroup
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'rg-1',
        relations: [{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q100' } }],
      }),
    });
    // Wikidata sitelinks
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        entities: { Q100: { sitelinks: { enwiki: { title: 'Album' } } } },
      }),
    });
    // Wikipedia extract
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        extract: 'Great album.',
        content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Album' } },
      }),
    });

    const result = await getAlbumDescription('Artist', 'Album', 'release-1');
    expect(result).toEqual({
      description: 'Great album.',
      url: 'https://en.wikipedia.org/wiki/Album',
    });
    // release lookup + release-group rels + wikidata + wikipedia = 4 calls
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('searches MusicBrainz when no MBID is provided', async () => {
    // searchReleaseGroupMBID
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ 'release-groups': [{ id: 'rg-2' }] }),
    });
    // getWikidataIdForReleaseGroup
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'rg-2',
        relations: [{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q200' } }],
      }),
    });
    // Wikidata sitelinks
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        entities: { Q200: { sitelinks: { enwiki: { title: 'Found Album' } } } },
      }),
    });
    // Wikipedia extract
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        extract: 'Found description.',
        content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Found_Album' } },
      }),
    });

    const result = await getAlbumDescription('Artist', 'Album');
    expect(result).toEqual({
      description: 'Found description.',
      url: 'https://en.wikipedia.org/wiki/Found_Album',
    });
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('falls back to search when release lookup fails', async () => {
    // getReleaseGroupIdForRelease — fails
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    // searchReleaseGroupMBID fallback
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ 'release-groups': [{ id: 'rg-found' }] }),
    });
    // getWikidataIdForReleaseGroup
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'rg-found',
        relations: [{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q300' } }],
      }),
    });
    // Wikidata sitelinks
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        entities: { Q300: { sitelinks: { enwiki: { title: 'Fallback Album' } } } },
      }),
    });
    // Wikipedia extract
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        extract: 'Fallback description.',
        content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Fallback_Album' } },
      }),
    });

    const result = await getAlbumDescription('Artist', 'Album', 'bad-release-id');
    expect(result).toEqual({
      description: 'Fallback description.',
      url: 'https://en.wikipedia.org/wiki/Fallback_Album',
    });
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it('returns null when both release lookup and search fail', async () => {
    // getReleaseGroupIdForRelease — no release-group field
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'release-1' }),
    });
    // searchReleaseGroupMBID — no results
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ 'release-groups': [] }),
    });
    expect(await getAlbumDescription('A', 'B', 'release-1')).toBeNull();
  });

  it('returns null when MusicBrainz search finds nothing', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ 'release-groups': [] }),
    });
    expect(await getAlbumDescription('Nobody', 'Nothing')).toBeNull();
  });

  it('uses MBID directly as release-group when isReleaseGroupId is true', async () => {
    // getWikidataIdForReleaseGroup — no release lookup needed
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'rg-override',
        relations: [{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q999' } }],
      }),
    });
    // Wikidata sitelinks
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        entities: { Q999: { sitelinks: { enwiki: { title: 'Override Album' } } } },
      }),
    });
    // Wikipedia extract
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        extract: 'Override description.',
        content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Override_Album' } },
      }),
    });

    const result = await getAlbumDescription('Artist', 'Album', 'rg-override', true);
    expect(result).toEqual({
      description: 'Override description.',
      url: 'https://en.wikipedia.org/wiki/Override_Album',
    });
    // Only 3 calls (no release lookup): release-group rels + wikidata + wikipedia
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('returns null on fetch error', async () => {
    mockFetch.mockRejectedValue(new Error('network'));
    expect(await getAlbumDescription('A', 'B')).toBeNull();
  });
});

describe('AbortSignal forwarding', () => {
  it('passes the signal through searchArtistMBID', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ artists: [] }) });
    const ctrl = new AbortController();
    await searchArtistMBID('x', ctrl.signal);
    expect(mockFetch.mock.calls[0][1].signal).toBe(ctrl.signal);
  });

  it('passes the signal through searchArtists', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ artists: [] }) });
    const ctrl = new AbortController();
    await searchArtists('x', 5, ctrl.signal);
    expect(mockFetch.mock.calls[0][1].signal).toBe(ctrl.signal);
  });

  it('passes the signal through getArtistBiography', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const ctrl = new AbortController();
    await getArtistBiography('mbid', ctrl.signal);
    expect(mockFetch.mock.calls[0][1].signal).toBe(ctrl.signal);
  });

  it('passes the signal through searchReleaseGroupMBID', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const ctrl = new AbortController();
    await searchReleaseGroupMBID('a', 'b', ctrl.signal);
    expect(mockFetch.mock.calls[0][1].signal).toBe(ctrl.signal);
  });

  it('passes the signal through searchReleaseGroups', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const ctrl = new AbortController();
    await searchReleaseGroups('x', 'a', 5, ctrl.signal);
    expect(mockFetch.mock.calls[0][1].signal).toBe(ctrl.signal);
  });

  it('passes the signal through getReleaseGroupIdForRelease', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const ctrl = new AbortController();
    await getReleaseGroupIdForRelease('rel', ctrl.signal);
    expect(mockFetch.mock.calls[0][1].signal).toBe(ctrl.signal);
  });

  it('passes the signal through getWikidataIdForReleaseGroup', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const ctrl = new AbortController();
    await getWikidataIdForReleaseGroup('rg', ctrl.signal);
    expect(mockFetch.mock.calls[0][1].signal).toBe(ctrl.signal);
  });

  it('passes the signal through getWikipediaExtractForAlbum', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const ctrl = new AbortController();
    await getWikipediaExtractForAlbum('Q1', ctrl.signal);
    expect(mockFetch.mock.calls[0][1].signal).toBe(ctrl.signal);
  });

  it('threads the signal through getAlbumDescription to every sub-fetch', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ 'release-group': { id: 'rg-1' } }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          relations: [{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q99' } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ entities: { Q99: { sitelinks: { enwiki: { title: 'X' } } } } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ extract: 'desc', content_urls: { desktop: { page: 'https://x' } } }),
      });
    const ctrl = new AbortController();
    await getAlbumDescription('Artist', 'Album', 'rel-1', false, ctrl.signal);
    // All 4 sub-fetches receive the same signal
    for (const call of mockFetch.mock.calls) {
      expect(call[1].signal).toBe(ctrl.signal);
    }
  });
});

describe('escapeLuceneQuery', () => {
  it('escapes the canonical Lucene specials', () => {
    expect(escapeLuceneQuery('AC/DC')).toBe('AC\\/DC');
    expect(escapeLuceneQuery('P!nk')).toBe('P\\!nk');
    expect(escapeLuceneQuery('blink-182')).toBe('blink\\-182');
    expect(escapeLuceneQuery('Foo: Bar')).toBe('Foo\\: Bar');
    expect(escapeLuceneQuery('Sigur Rós')).toBe('Sigur Rós');
    expect(escapeLuceneQuery('Foo & Bar | Baz')).toBe('Foo \\& Bar \\| Baz');
    expect(escapeLuceneQuery('Foo (Live)')).toBe('Foo \\(Live\\)');
  });
});

describe('fetchWithRetry (exercised via searchArtistMBID)', () => {
  it('retries once on 503 then returns the second response', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          artists: [{ id: 'mbid-x', score: 100, type: 'Group' }],
        }),
      });
    expect(await searchArtistMBID('Radiohead')).toBe('mbid-x');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries once on 429', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          artists: [{ id: 'mbid-y', score: 100, type: 'Group' }],
        }),
      });
    expect(await searchArtistMBID('Test')).toBe('mbid-y');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries once on a transport throw', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          artists: [{ id: 'mbid-z', score: 100, type: 'Group' }],
        }),
      });
    expect(await searchArtistMBID('Test')).toBe('mbid-z');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 404', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    expect(await searchArtistMBID('Test')).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('gives up after a single retry that still returns 503', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });
    expect(await searchArtistMBID('Test')).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('getWikidataIdForArtist', () => {
  it('extracts the Q-number from a wikidata url-rel', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'mbid-1',
        relations: [
          { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q123' } },
          { type: 'official homepage', url: { resource: 'https://example.com/' } },
        ],
      }),
    });
    expect(await getWikidataIdForArtist('mbid-1')).toBe('Q123');
  });

  it('returns null when no wikidata relation exists', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'mbid-1', relations: [] }),
    });
    expect(await getWikidataIdForArtist('mbid-1')).toBeNull();
  });

  it('returns null on a 404', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    expect(await getWikidataIdForArtist('bad-mbid')).toBeNull();
  });
});
