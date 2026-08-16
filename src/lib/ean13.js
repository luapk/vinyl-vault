// EAN-13 / UPC-A helpers.
//
// Used to validate a decoded barcode before it is sent anywhere: every EAN-13
// and UPC-A carries a check digit, so a misread is caught locally instead of
// burning a Discogs lookup (and a second of the user's time) on a number that
// cannot exist. The renderer is used by the decode test harness.

const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
const PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];

// Check digit for the first 12 digits of an EAN-13 (or 11 of a UPC-A).
export function checkDigit(digits) {
  const d = String(digits).replace(/\D/g, '');
  let sum = 0;
  // Weights alternate 1,3 counting from the RIGHT of the final code.
  const weighted = d.split('').reverse();
  weighted.forEach((ch, i) => { sum += Number(ch) * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10;
}

// True when the code is a structurally valid EAN-13, EAN-8 or UPC-A.
export function isValidBarcode(code) {
  const d = String(code || '').replace(/\D/g, '');
  if (![8, 12, 13].includes(d.length)) return false;
  return checkDigit(d.slice(0, -1)) === Number(d[d.length - 1]);
}

// Module string (95 modules) for a 13-digit code. Throws on a bad code.
export function ean13Modules(code) {
  const d = String(code).replace(/\D/g, '');
  if (d.length !== 13) throw new Error('EAN-13 needs 13 digits');
  const parity = PARITY[Number(d[0])];
  let out = '101';
  for (let i = 1; i <= 6; i++) {
    out += parity[i - 1] === 'L' ? L[Number(d[i])] : G[Number(d[i])];
  }
  out += '01010';
  for (let i = 7; i <= 12; i++) out += R[Number(d[i])];
  return out + '101';
}

// Draw a real, scannable EAN-13 onto a canvas context.
export function drawEan13(ctx, code, { x = 0, y = 0, width = 400, height = 160, quiet = true } = {}) {
  const modules = ean13Modules(code);
  const quietModules = quiet ? 11 : 0;
  const total = modules.length + quietModules * 2;
  const mw = width / total;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = '#000000';
  // Draw runs of dark modules as single exact rectangles. Rounding each module
  // up individually bleeds into the neighbouring light module and distorts the
  // bar/space ratios the decoder measures, which makes the code unreadable.
  let i = 0;
  while (i < modules.length) {
    if (modules[i] === '0') { i++; continue; }
    let j = i;
    while (j < modules.length && modules[j] === '1') j++;
    const x0 = x + (quietModules + i) * mw;
    const x1 = x + (quietModules + j) * mw;
    ctx.fillRect(x0, y, x1 - x0, height * 0.78);
    i = j;
  }
  ctx.fillStyle = '#000000';
  ctx.font = `${Math.round(height * 0.16)}px monospace`;
  ctx.fillText(`${code[0]} ${code.slice(1, 7)} ${code.slice(7)}`, x + width * 0.12, y + height * 0.96);
}
