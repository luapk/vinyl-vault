const TABLE = {
  '0,1': '8B', '1,1': '3B', '2,1': '10B', '3,1': '5B',
  '4,1': '12B', '5,1': '7B', '6,1': '2B', '7,1': '9B',
  '8,1': '4B', '9,1': '11B', '10,1': '6B', '11,1': '1B',
  '0,0': '5A', '1,0': '12A', '2,0': '7A', '3,0': '2A',
  '4,0': '9A', '5,0': '4A', '6,0': '11A', '7,0': '6A',
  '8,0': '1A', '9,0': '8A', '10,0': '3A', '11,0': '10A',
};

export const CAMELOT_TABLE = TABLE;

export function toCamelot(spotifyKey, mode) {
  if (spotifyKey == null || mode == null) return null;
  return TABLE[`${spotifyKey},${mode}`] ?? null;
}

// Camelot wheel colour for a key badge. The 12 numbers walk the hue circle so
// harmonically adjacent keys sit next to each other in colour too; the A/B
// letter (minor/major) varies saturation and lightness.
export const camelotColor = (key) => {
  if (!key) return "rgb(120,120,130)";
  const num = parseInt(key, 10);
  const letter = key.slice(-1).toUpperCase();
  if (isNaN(num) || num < 1 || num > 12) return "rgb(120,120,130)";
  const hue = ((num - 1) * 30) % 360;
  return `hsl(${hue}, ${letter === "B" ? 70 : 55}%, ${letter === "B" ? 68 : 62}%)`;
};
