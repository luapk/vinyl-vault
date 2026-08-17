// Writing the collection to localStorage without blowing the quota.
//
// Every scanned record carries its photo as a base64 data URL (a 1500px JPEG,
// roughly 200-400KB once encoded). A few dozen records exceed the ~5MB
// localStorage budget on their own, at which point setItem throws
// QuotaExceededError and the local cache stops updating -- silently, which is
// worse than it sounds: that cache is the safety net that keeps unsynced scans
// alive across a reload.
//
// So the cache is written slimmed. Photos are dropped for records that are
// safely in the cloud, and kept only for records whose photo exists nowhere
// else. If it still does not fit, it degrades in stages rather than failing:
// drop the remaining photos, then the extra image lists, then the oldest
// records. A smaller cache always beats no cache.

const isDataUrl = (v) => typeof v === 'string' && v.startsWith('data:');

// Strip embedded image payloads from a record. Cloud-hosted URLs are kept:
// they cost a few dozen bytes and still render.
function stripPhotos(record) {
  const out = { ...record };
  if (isDataUrl(out.coverUrl)) out.coverUrl = null;
  if (Array.isArray(out.images)) {
    const kept = out.images.filter(u => !isDataUrl(u));
    out.images = kept.length ? kept : undefined;
    if (!out.images) delete out.images;
  }
  return out;
}

const hasPhotoPayload = (r) =>
  isDataUrl(r?.coverUrl) || (Array.isArray(r?.images) && r.images.some(isDataUrl));

// Records whose photo lives only on this device keep it; everything else is
// slimmed. keepPhotosFor is the set of record ids not yet confirmed in the DB.
export function slimForCache(records, keepPhotosFor = new Set()) {
  return records.map(r => (keepPhotosFor.has(r?.id) ? r : stripPhotos(r)));
}

// Which of THESE records still hold the only copy of their photo. Derived from
// the list being written rather than from component state: a record created a
// moment ago is not in state yet, and computing this from state stripped the
// newest scan's photo -- the one most likely to be the only copy.
export function photosToKeep(records, confirmedIds = {}) {
  return new Set(records.filter(r => r?.id && !confirmedIds[r.id]).map(r => r.id));
}

// Progressively smaller candidates, best first. Exported for tests.
export function cacheCandidates(records, keepPhotosFor = new Set()) {
  const slim = slimForCache(records, keepPhotosFor);
  const candidates = [{ level: 'slim', records: slim }];

  if (slim.some(hasPhotoPayload)) {
    candidates.push({ level: 'no-photos', records: slim.map(stripPhotos) });
  }
  const noPhotos = candidates[candidates.length - 1].records;

  // Newest first, so if we have to cut, the oldest go. savedAt is a timestamp.
  const byNewest = [...noPhotos].sort((a, b) => (b?.savedAt || 0) - (a?.savedAt || 0));
  for (const keep of [400, 200, 100, 50]) {
    if (byNewest.length > keep) candidates.push({ level: `newest-${keep}`, records: byNewest.slice(0, keep) });
  }
  return candidates;
}

// Writes the largest form that fits. Returns what it managed:
//   { ok, level, wrote, dropped }  or  { ok: false } if even the smallest fails.
export function writeCollectionCache(storage, key, records, keepPhotosFor = new Set()) {
  for (const candidate of cacheCandidates(records, keepPhotosFor)) {
    try {
      storage.setItem(key, JSON.stringify(candidate.records));
      return {
        ok: true,
        level: candidate.level,
        wrote: candidate.records.length,
        dropped: records.length - candidate.records.length,
      };
    } catch (err) {
      // Quota (or a full disk): try the next, smaller form. Anything else is
      // not going to be fixed by shrinking, so give up immediately.
      const quota = err?.name === 'QuotaExceededError'
        || err?.name === 'NS_ERROR_DOM_QUOTA_REACHED'
        || err?.code === 22 || err?.code === 1014;
      if (!quota) return { ok: false, error: err };
    }
  }
  return { ok: false, error: new Error('collection does not fit in local storage') };
}

// Small values (preferences, flags) that must never take the app down when the
// quota is gone. Returns true when the write landed.
export function safeSetItem(storage, key, value) {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
