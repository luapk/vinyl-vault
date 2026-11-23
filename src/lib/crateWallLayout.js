// Layouts for the 3D crate wall: the whole collection as one flat wall of
// covers, and the same covers stacked by crate as solid tetromino piles.
//
// Positions are in cover units (a cover is 1 x 1, CELL apart). y is up.

export const CELL = 1.08;
export const STACK_W = 4;
export const UNFILED = 'Unfiled';

// Two tetrominoes that exactly fill a 4 x 2 block, as [piece A cells, piece B cells].
// Filling a stack two rows at a time from these always tiles it solid, where a
// free search can take seconds on a thousand-record crate.
const BLOCKS = [
  [[[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 1], [1, 1], [2, 1], [3, 1]]],   // I, I
  [[[0, 0], [1, 0], [0, 1], [1, 1]], [[2, 0], [3, 0], [2, 1], [3, 1]]],   // O, O
  [[[0, 0], [1, 0], [2, 0], [0, 1]], [[3, 0], [1, 1], [2, 1], [3, 1]]],   // J, L
  [[[0, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [2, 0], [3, 0], [3, 1]]],   // L, J
];

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Cells of a stack `rows` high, grouped into tetrominoes, bottom row first.
export function tileStack(rows, seed = 1) {
  const pieces = [];
  let s = seed || 1;
  const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) >>> 0) % 1000) / 1000;
  let y = 0;
  for (; y + 2 <= rows; y += 2) {
    const [a, b] = BLOCKS[Math.floor(rnd() * BLOCKS.length)];
    pieces.push(a.map(([x, dy]) => [x, y + dy]), b.map(([x, dy]) => [x, y + dy]));
  }
  if (y < rows) pieces.push([[0, y], [1, y], [2, y], [3, y]]);
  return pieces;
}

// A wall `cols` wide, centred on the origin, filled left to right from the top.
export function wallLayout(n, aspect = 1) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * Math.max(0.3, aspect))));
  const rows = Math.ceil(n / cols);
  const pos = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    pos.push([(c - (cols - 1) / 2) * CELL, ((rows - 1) / 2 - r) * CELL, 0]);
  }
  return { pos, width: cols * CELL, height: rows * CELL };
}

// Every record goes to its first crate (or Unfiled). Each crate becomes a stack
// 4 covers wide, tiled with tetrominoes. Stacks sit in rows, biggest first; the
// front row stands on y = 0 and each row behind steps back, up and across.
export function crateLayout(records, perRow = 4) {
  const groups = new Map();
  records.forEach((r, i) => {
    const name = (Array.isArray(r.crates) && r.crates[0]) || UNFILED;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(i);
  });
  const crates = [...groups.entries()]
    .map(([name, idx]) => ({ name, idx }))
    .sort((a, b) => (a.name === UNFILED) - (b.name === UNFILED) || b.idx.length - a.idx.length || a.name.localeCompare(b.name));

  const gap = 1.6, stackW = STACK_W * CELL;
  const pos = new Array(records.length);
  const piece = new Array(records.length);
  const labels = [];
  let pieceId = 0, maxH = 0;
  // Rows behind the first step up a tier and sit half a stack across, so a
  // back stack is never hidden directly behind the one in front of it.
  const TIER = 3.2;
  crates.forEach((crate, k) => {
    const row = Math.floor(k / perRow), col = k % perRow;
    const inRow = Math.min(perRow, crates.length - row * perRow);
    const stagger = row % 2 ? (stackW + gap) / 2 : 0;
    const x0 = (col - (inRow - 1) / 2) * (stackW + gap) - stackW / 2 + stagger;
    const z = -row * 9;
    const base = row * TIER;
    const rows = Math.ceil(crate.idx.length / STACK_W);
    const pieces = tileStack(rows, hash(crate.name));
    let n = 0;
    for (const cells of pieces) {
      for (const [x, y] of cells) {
        if (n >= crate.idx.length) break;
        const i = crate.idx[n++];
        pos[i] = [x0 + (x + 0.5) * CELL, base + (y + 0.5) * CELL, z];
        piece[i] = pieceId;
      }
      pieceId++;
    }
    maxH = Math.max(maxH, base + rows * CELL);
    labels.push({ name: crate.name, count: crate.idx.length, x: x0 + stackW / 2, y: base - 0.75, z, width: stackW });
  });
  const rowsOfStacks = Math.ceil(crates.length / perRow);
  return { pos, piece, labels, crates: crates.length, depth: (rowsOfStacks - 1) * 9, maxH,
    width: Math.min(perRow, crates.length) * (stackW + gap) - gap };
}
