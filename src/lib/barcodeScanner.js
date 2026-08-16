// On-device barcode decoding.
//
// Why this exists: reading the barcode on the phone turns a scan from
// "photograph, upload, run a vision model, search" into "point, and it is
// already looking it up". The decoder runs on the live preview, so there is no
// shutter press and no image upload at all -- the only network call left is the
// Discogs lookup, which is why the mode feels instant.
//
// The decoder is a WASM build of ZXing, loaded lazily the first time barcode
// mode is opened, so nobody else pays for it. The .wasm is served from our own
// origin (public/zxing_reader.wasm): the library defaults to a public CDN,
// which would add a cold fetch to the first scan and put a third party in the
// path of a core feature.
import { isValidBarcode } from './ean13.js';

const WASM_URL = '/zxing_reader.wasm';
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

let detectorPromise = null;

export function loadBarcodeDetector() {
  if (detectorPromise) return detectorPromise;
  detectorPromise = (async () => {
    // Native BarcodeDetector where the browser has one (Chrome, Android): no
    // download at all, and it is hardware-accelerated. Safari has none, which
    // is why the WASM fallback is not optional.
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        if (FORMATS.some(f => supported.includes(f))) {
          return new window.BarcodeDetector({ formats: FORMATS.filter(f => supported.includes(f)) });
        }
      } catch { /* fall through to the WASM build */ }
    }
    const zx = await import('barcode-detector/ponyfill');
    zx.setZXingModuleOverrides({
      locateFile: (path, prefix) => (path.endsWith('.wasm') ? WASM_URL : prefix + path),
    });
    return new zx.BarcodeDetector({ formats: FORMATS });
  })().catch(err => {
    detectorPromise = null; // let a later attempt retry
    throw err;
  });
  return detectorPromise;
}

// Returns a valid barcode string, or null. Never returns a guess: every result
// is checksum-verified, so a partial read is dropped rather than sent to
// Discogs. The benchmark (scripts/barcode-bench.mjs) shows failures are always
// no-reads, so a caller can simply try the next frame.
export async function detectBarcode(source) {
  try {
    const detector = await loadBarcodeDetector();
    const found = await detector.detect(source);
    for (const b of found) {
      const value = String(b.rawValue || '').replace(/\D/g, '');
      if (isValidBarcode(value)) return value;
    }
    return null;
  } catch {
    return null;
  }
}
