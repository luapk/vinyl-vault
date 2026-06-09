import { supabase } from './supabase';

// Cover art self-hosting. Discogs image URLs are hotlinked, rate limited, and
// can expire, so covers are copied into the Supabase 'covers' storage bucket
// (see supabase/storage.sql) when a record is saved. Discogs blocks
// cross-origin fetches, so the download goes through /api/image-proxy.

const STORAGE_MARKER = '/storage/v1/object/public/covers/';

export function isCachedCover(url) {
  return !!url && url.includes(STORAGE_MARKER);
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
    const path = `${userId}/${recordId}.${ext}`;
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
