import { describe, it, expect } from 'vitest';
import { tileStack, wallLayout, crateLayout, UNFILED, STACK_W } from '../crateWallLayout.js';

describe('tileStack', () => {
  it('fills every cell of a 4-wide stack exactly once, in tetrominoes', () => {
    for (const rows of [1, 2, 3, 7, 50]) {
      const pieces = tileStack(rows, rows * 7);
      const seen = new Set();
      for (const cells of pieces) {
        expect(cells).toHaveLength(4);
        for (const [x, y] of cells) {
          expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(STACK_W);
          expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(rows);
          const k = `${x},${y}`;
          expect(seen.has(k)).toBe(false);
          seen.add(k);
        }
      }
      expect(seen.size).toBe(rows * STACK_W);
    }
  });
});

describe('wallLayout', () => {
  it('places every record once, centred', () => {
    const { pos } = wallLayout(10, 1);
    expect(pos).toHaveLength(10);
    expect(new Set(pos.map(p => p.join())).size).toBe(10);
  });
});

describe('crateLayout', () => {
  const rec = (crates) => ({ crates });
  it('gives every record its own cell, in the stack of its first crate', () => {
    const records = [rec(['A']), rec(['A', 'B']), rec([]), rec(['B']), rec(['A']), rec(undefined), rec(['A']), rec(['A']), rec(['A'])];
    const { pos, piece, labels } = crateLayout(records);
    expect(pos.every(Boolean)).toBe(true);
    expect(new Set(pos.map(p => p.join())).size).toBe(records.length);
    const names = labels.map(l => l.name);
    expect(names[0]).toBe('A');                 // biggest first
    expect(names[names.length - 1]).toBe(UNFILED); // unfiled last, whatever its size
    expect(labels.find(l => l.name === 'A').count).toBe(6);
    // a piece never holds more than four records
    const sizes = {};
    piece.forEach(p => { sizes[p] = (sizes[p] || 0) + 1; });
    expect(Math.max(...Object.values(sizes))).toBeLessThanOrEqual(4);
  });
});
