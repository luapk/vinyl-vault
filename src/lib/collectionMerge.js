// Pure merge planner for the cloud/local collection reconciliation.
// Extracted from useCollection so the data-safety invariant is unit-testable:
//
//   A record present on this device can only leave the collection via an
//   explicit user delete (tombstone). The merge NEVER drops a local record,
//   whether or not its upload has succeeded.
//
// Inputs:
//   dbRows       -- rows from Supabase, each { ...data, _dbId } (data's own
//                   `id` is the record's stable local UUID)
//   localRecords -- current in-memory state followed by localStorage contents
//   tombstones   -- Set of record ids the user explicitly deleted
//   dirtyIds     -- Set of record ids with local EDITS not yet confirmed
//                   written to the DB. For these, the local version is the
//                   source of truth: it replaces the DB copy in the merge and
//                   is queued for upload. (Without this, an edit whose sync
//                   failed -- e.g. re-identify during an expired session --
//                   was silently reverted to the cloud copy on next load.)
//
// Returns:
//   records     -- merged collection (local-only records first)
//   dbIdMap     -- { localRecordId: dbRowId } for every record with a row
//   spareRowIds -- duplicate DB row ids (same record UUID twice) to delete;
//                  UUID-duplicate rows only appear when an insert was retried
//                  after a lost response, so deleting the older copy is safe
//   toInsert    -- local records with no DB row yet (upload these; failures
//                  leave them in `records` as unsynced, never dropped)
//   toUpdate    -- dirty local records that DO have a DB row (push these with
//                  dbUpdate; failures keep them dirty for the retry loop)
const isDataUrl = (v) => typeof v === 'string' && v.startsWith('data:');

// Put back any photo the LOCAL CACHE stripped, before a dirty record is
// pushed over the cloud copy.
//
// The cache deliberately drops data-URL photos for records that have a DB row
// (localCache.photosToKeep), because the cloud is holding them. But on a cold
// start the in-memory collection IS that stripped cache, so a record carrying
// an unconfirmed edit replaced the cloud copy with a hollowed-out version and
// dbUpdate -- which rewrites `data` wholesale -- destroyed the photo. The only
// photos that can be destroyed this way are the ones that exist NOWHERE else:
// a user's own cover whose upload to the bucket failed, where the data URL is
// the last copy. The fallback meant to protect the photo was losing it.
//
// Only `data:` payloads are restored, and only where the local copy has none.
// That is exactly what the cache removes and nothing else, so a cover the user
// actually changed still wins.
function restoreStrippedPhotos(local, cloud) {
  if (!cloud) return local;
  const out = { ...local };
  if (!out.coverUrl && isDataUrl(cloud.coverUrl)) out.coverUrl = cloud.coverUrl;
  const rescued = (Array.isArray(cloud.images) ? cloud.images : []).filter(isDataUrl);
  if (rescued.length) {
    const have = new Set(Array.isArray(out.images) ? out.images : []);
    const missing = rescued.filter(u => !have.has(u));
    // Appended rather than re-interleaved: the original positions are not
    // recoverable from a stripped list, and `coverUrl` is what gets displayed.
    if (missing.length) out.images = [...(Array.isArray(out.images) ? out.images : []), ...missing];
  }
  return out;
}

export function planLoadMerge(dbRows, localRecords, tombstones, dirtyIds = new Set()) {
  const byId = new Map();
  const spareRowIds = [];
  for (const row of dbRows) {
    if (!row?.id) continue;
    const prev = byId.get(row.id);
    if (!prev) { byId.set(row.id, row); continue; }
    const loser = (row.savedAt || 0) >= (prev.savedAt || 0) ? prev : row;
    const winner = loser === prev ? row : prev;
    if (loser._dbId) spareRowIds.push(loser._dbId);
    byId.set(winner.id, winner);
  }

  const dbIdMap = {};
  const records = [...byId.values()].map(r => {
    if (r._dbId) dbIdMap[r.id] = r._dbId;
    const c = { ...r };
    delete c._dbId;
    return c;
  });

  const known = new Set(records.map(r => r.id));
  const toInsert = [];
  const toUpdate = [];
  const replacedDirty = new Set();
  for (const record of localRecords) {
    if (!record?.id || tombstones.has(record.id)) continue;
    if (known.has(record.id)) {
      // Already in the cloud. Normally the cloud copy wins (cross-device
      // freshness) -- EXCEPT when this record carries an unconfirmed local
      // edit: then the local version replaces it in place and is re-pushed.
      if (dirtyIds.has(record.id) && !replacedDirty.has(record.id)) {
        replacedDirty.add(record.id);
        const idx = records.findIndex(r => r.id === record.id);
        if (idx !== -1) {
          const whole = restoreStrippedPhotos(record, records[idx]);
          records[idx] = whole;
          if (dbIdMap[record.id]) toUpdate.push(whole);
        }
      }
      continue;
    }
    known.add(record.id);
    records.unshift(record);
    toInsert.push(record);
  }

  return { records, dbIdMap, spareRowIds, toInsert, toUpdate };
}
