import { describe, it, expect } from 'vitest';
import { parseImportRows } from '../importParse.js';

describe('parseImportRows -- forgiving record-list parsing', () => {
  it('parses plain "Artist - Title" lines (hyphen, en dash, em dash)', () => {
    const rows = parseImportRows('Pavement - Slanted and Enchanted\nBjörk – Debut\nPulp — Different Class');
    expect(rows).toEqual([
      { artist: 'Pavement', title: 'Slanted and Enchanted' },
      { artist: 'Björk', title: 'Debut' },
      { artist: 'Pulp', title: 'Different Class' },
    ]);
  });

  it('keeps dashes inside titles', () => {
    const rows = parseImportRows('Dinosaur Jr - Ear-Bleeding Country - The Best Of');
    expect(rows[0].artist).toBe('Dinosaur Jr');
    expect(rows[0].title).toBe('Ear-Bleeding Country - The Best Of');
  });

  it('a line with no dash becomes title-only (still searchable)', () => {
    expect(parseImportRows('Hot Fuss')).toEqual([{ artist: '', title: 'Hot Fuss' }]);
  });

  it('parses headered CSV with artist/title columns in any position', () => {
    const rows = parseImportRows('Year,Title,Artist\n2004,Hot Fuss,The Killers\n1993,Debut,"Björk"');
    expect(rows).toEqual([
      { artist: 'The Killers', title: 'Hot Fuss' },
      { artist: 'Björk', title: 'Debut' },
    ]);
  });

  it('accepts Discogs-style header aliases (Album, Artists)', () => {
    const rows = parseImportRows('Artists;Album\nInterpol;El Pintor');
    expect(rows).toEqual([{ artist: 'Interpol', title: 'El Pintor' }]);
  });

  it('headerless two-column CSV is artist,title', () => {
    const rows = parseImportRows('The Kills,Midnight Boom\nMuse,Drones');
    expect(rows).toEqual([
      { artist: 'The Kills', title: 'Midnight Boom' },
      { artist: 'Muse', title: 'Drones' },
    ]);
  });

  it('handles quoted cells containing the delimiter', () => {
    const rows = parseImportRows('artist,title\n"Crosby, Stills & Nash","Déjà Vu"');
    expect(rows).toEqual([{ artist: 'Crosby, Stills & Nash', title: 'Déjà Vu' }]);
  });

  it('parses TSV', () => {
    const rows = parseImportRows('artist\ttitle\nJeff Buckley\tGrace');
    expect(rows).toEqual([{ artist: 'Jeff Buckley', title: 'Grace' }]);
  });

  it('drops blank lines and in-file duplicates (case-insensitive)', () => {
    const rows = parseImportRows('Pixies - Doolittle\n\npixies - doolittle\nPixies - Bossanova');
    expect(rows).toHaveLength(2);
  });

  it('a comma inside an unquoted dash-line does not force CSV mode for one-off commas', () => {
    const rows = parseImportRows('Nick Cave - From Her to Eternity\nEcho and the Bunnymen - Ocean Rain');
    expect(rows).toEqual([
      { artist: 'Nick Cave', title: 'From Her to Eternity' },
      { artist: 'Echo and the Bunnymen', title: 'Ocean Rain' },
    ]);
  });

  it('caps at 500 rows', () => {
    const big = Array.from({ length: 600 }, (_, i) => `Artist ${i} - Title ${i}`).join('\n');
    expect(parseImportRows(big)).toHaveLength(500);
  });

  it('empty input returns empty', () => {
    expect(parseImportRows('')).toEqual([]);
    expect(parseImportRows('\n\n')).toEqual([]);
  });
});
