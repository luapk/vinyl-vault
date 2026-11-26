// Vinyl colour / pressing types. `bg` is a CSS background, so a colour can be
// a gradient (gold, marbled, splatter, picture disc).
export const VINYL_COLORS = [
  { id: 'black',    label: 'Black',       bg: '#1a1a1a' },
  { id: 'clear',    label: 'Clear',       bg: 'rgba(190,220,240,0.45)', border: 'rgba(180,210,230,0.6)' },
  { id: 'white',    label: 'White',       bg: '#e2e2e2', border: 'rgba(0,0,0,0.18)' },
  { id: 'red',      label: 'Red',         bg: '#c0392b' },
  { id: 'blue',     label: 'Blue',        bg: '#1a6fa8' },
  { id: 'green',    label: 'Green',       bg: '#1e8449' },
  { id: 'yellow',   label: 'Yellow',      bg: '#d4ac0d', border: 'rgba(0,0,0,0.12)' },
  { id: 'orange',   label: 'Orange',      bg: '#ca6f1e' },
  { id: 'pink',     label: 'Pink',        bg: '#cb4397' },
  { id: 'purple',   label: 'Purple',      bg: '#7d3c98' },
  { id: 'gold',     label: 'Gold',        bg: 'linear-gradient(135deg,#b8952a,#e8cf6a,#b8952a)' },
  { id: 'marbled',  label: 'Marbled',     bg: 'conic-gradient(#c0392b 0deg,#1a6fa8 120deg,#1a1a1a 240deg,#c0392b 360deg)' },
  { id: 'splatter', label: 'Splatter',    bg: 'radial-gradient(circle at 30% 40%,#cb4397 0%,#cb4397 12%,#1a1a1a 12%,#1a1a1a 100%),radial-gradient(circle at 70% 60%,#d4ac0d 0%,#d4ac0d 8%,transparent 8%)' },
  { id: 'picture',  label: 'Picture',     bg: 'linear-gradient(135deg,#8e44ad,#2980b9,#27ae60)' },
];
