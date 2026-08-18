import { supabase } from './supabase';

// Cover art self-hosting. Discogs image URLs are hotlinked, rate limited, and
// can expire, so covers are copied into the Supabase 'covers' storage bucket
// (see supabase/storage.sql) when a record is saved. Discogs blocks
// cross-origin fetches, so the download goes through /api/image-proxy.

const STORAGE_MARKER = '/storage/v1/object/public/covers/';

export function isCachedCover(url) {
  return !!url && url.includes(STORAGE_MARKER);
}

// Short stable hash of the source URL. Part of the storage path so that a
// record whose cover CHANGES (re-identify, manual cover pick) gets a NEW
// public URL. The old path used only the record id: re-caching a new cover
// produced the identical URL, and with the 1-year immutable cache header the
// browser and CDN kept serving the old image forever.
function srcHash(url) {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h * 33) ^ url.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Returns the public storage URL on success, null on any failure.
// Failures are silent by design: the original URL keeps working as before.
export async function cacheCover(userId, recordId, coverUrl) {
  if (!supabase || !userId || !recordId || !coverUrl) return null;
  if (isCachedCover(coverUrl) || !/^https?:\/\//.test(coverUrl)) return null;
  try {
    const resp = await fetch(`/api/image-proxy?url=${encodeURIComponent(coverUrl)}`);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    if (!blob.type.startsWith('image/') || blob.size === 0) return null;
    const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${userId}/${recordId}-${srcHash(coverUrl)}.${ext}`;
    const { error } = await supabase.storage
      .from('covers')
      .upload(path, blob, { upsert: true, contentType: blob.type, cacheControl: '31536000' });
    if (error) return null;
    const { data } = supabase.storage.from('covers').getPublicUrl(path);
    return data?.publicUrl || null;
  } catch {
    return null;
  }
}

// A cover the user supplied themselves: a photo of their own sleeve, or a
// better scan than Discogs holds. It goes into the same 'covers' bucket as the
// cached Discogs art, which means it syncs across devices and survives the
// localStorage slimming that deliberately drops data-URL photos.
//
// Returns the public URL, or null on any failure. Callers fall back to keeping
// the image as a local data URL, so a storage outage costs sync, not the photo.
export async function uploadUserCover(userId, blob, contentType = 'image/jpeg') {
  if (!supabase || !userId || !blob || !blob.size) return null;
  try {
    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    // Random suffix, never the record id: a replaced cover must get a NEW URL,
    // or the 1-year immutable cache header keeps serving the old image.
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const path = `${userId}/user-${stamp}.${ext}`;
    const { error } = await supabase.storage
      .from('covers')
      .upload(path, blob, { upsert: false, contentType, cacheControl: '31536000' });
    if (error) return null;
    const { data } = supabase.storage.from('covers').getPublicUrl(path);
    return data?.publicUrl || null;
  } catch {
    return null;
  }
}
