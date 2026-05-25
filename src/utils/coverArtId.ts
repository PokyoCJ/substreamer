/**
 * Resolve the cover-art lookup ID for a Subsonic entity.
 *
 * The Subsonic `getCoverArt` endpoint accepts any entity ID — artist /
 * album / playlist / song — and resolves the right cover server-side.
 * That means we don't have to think about the server's `coverArt` field
 * at all: it's full of server-specific quirks (Navidrome's `_<digit>`
 * per-track variants, `_<hex>` content-hash versions, orphan stripped
 * IDs from old buggy migrations). Keying off the entity ID instead is
 * spec-compliant, predictable, and produces ONE canonical cached file
 * per album / artist / playlist regardless of how many tracks it has.
 *
 * Helper returns `undefined` when the entity has no usable ID (rare —
 * usually only synthetic / sentinel entities). Callers that pass the
 * result to `CachedImage`'s `coverArtId` prop or `getCoverArtUrl` are
 * already null-safe for that case.
 */

import { type AlbumID3, type ArtistID3, type Child, type Playlist } from '../services/subsonicService';

export function coverArtIdForAlbum(album: { id?: string | null }): string | undefined {
  return album.id ?? undefined;
}

export function coverArtIdForArtist(artist: { id?: string | null }): string | undefined {
  return artist.id ?? undefined;
}

export function coverArtIdForPlaylist(playlist: { id?: string | null }): string | undefined {
  return playlist.id ?? undefined;
}

/**
 * Songs (Child) use the parent album's ID so every track in an album
 * shares the same cached cover file. Falls back to the song's own ID
 * for orphan entries (Internet-radio streams, songs the server returns
 * without an albumId).
 */
export function coverArtIdForSong(song: { id?: string | null; albumId?: string | null }): string | undefined {
  return song.albumId ?? song.id ?? undefined;
}

/**
 * Polymorphic dispatch over the four entity shapes. Useful when a
 * single render path handles multiple types (e.g. search results).
 * Prefer the type-specific helpers above when the entity type is known
 * at the call site.
 */
export function coverArtIdForEntity(
  entity: AlbumID3 | ArtistID3 | Playlist | Child,
): string | undefined {
  // Child has `albumId`; the others don't.
  if ('albumId' in entity) {
    return coverArtIdForSong(entity);
  }
  return entity.id ?? undefined;
}
