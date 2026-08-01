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
//
// Returns:
//   records     -- merged collection (local-only records first)
//   dbIdMap     -- { localRecordId: dbRowId } for every record with a row
//   spareRowIds -- duplicate DB row ids (same record UUID twice) to delete;
//                  UUID-duplicate rows only appear when an insert was retried
//                  after a lost response, so deleting the older copy is safe
//   toInsert    -- local records with no DB row yet (upload these; failures
//                  leave them in `records` as unsynced, never dropped)
export function planLoadMerge(dbRows, localRecords, tombstones) {
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
  for (const record of localRecords) {
    if (!record?.id || known.has(record.id) || tombstones.has(record.id)) continue;
    known.add(record.id);
    records.unshift(record);
    toInsert.push(record);
  }

  return { records, dbIdMap, spareRowIds, toInsert };
}
