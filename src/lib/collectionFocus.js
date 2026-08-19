// Focusing the collection on a slice of itself: the genre or decade a user
// tapped on the stats page, opened as though it were a crate.
//
// The decade buckets live here rather than inside the chart because both the
// chart and the filter need them. Two copies would drift, and the failure
// would be quiet: a bar reading 42 that opens onto 39 records, with nothing
// on screen to say which is wrong.

export const DECADES = ['60s', '70s', '80s', '90s', '00s', '10s', '20s'];

// The decade a release year falls in, or null when there is no usable year.
//
// Everything before 1970 is deliberately counted as the 60s rather than given
// buckets of its own: this is a chart of a record collection, where pre-1970
// pressings are a thin tail, and the alternative is a row of empty columns.
export function decadeOf(year) {
  const y = parseInt(year, 10);
  if (!y || Number.isNaN(y)) return null;
  if (y < 1970) return '60s';
  if (y < 1980) return '70s';
  if (y < 1990) return '80s';
  if (y < 2000) return '90s';
  if (y < 2010) return '00s';
  if (y < 2020) return '10s';
  return '20s';
}

// Tally a collection into the decade buckets, every bucket present so the
// chart keeps its shape when a decade is empty.
export function decadeCounts(collection = []) {
  const counts = Object.fromEntries(DECADES.map(d => [d, 0]));
  for (const record of collection) {
    const d = decadeOf(record?.year);
    if (d) counts[d]++;
  }
  return counts;
}

// Does this record belong to the focused slice? A null focus matches
// everything, so callers can pass it straight through.
export function matchesFocus(record, focus) {
  if (!focus) return true;
  if (focus.kind === 'genre') return (record?.genres || []).includes(focus.value);
  if (focus.kind === 'decade') return decadeOf(record?.year) === focus.value;
  return true;
}

// How the focus is described in the UI, on the pill and in the empty state.
export function focusLabel(focus) {
  if (!focus) return '';
  return focus.kind === 'decade' ? `${focus.value} releases` : focus.value;
}
