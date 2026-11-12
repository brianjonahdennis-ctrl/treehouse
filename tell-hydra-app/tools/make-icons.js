// Generates the treehouse app icons and splash screens for Android, iOS and the website (no dependencies).
// Artwork: the treehouse mark (brand/treehouse-mark.svg) in its pink-violet-blue gradient on navy.
//   node tools/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const RES = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');

// ---- tiny PNG writer -------------------------------------------------------
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
// opaque: write RGB without an alpha channel (the App Store rejects icons that have one).
function writePng(file, w, h, pixel, { opaque = false, S = 3 } = {}) {
  const bpp = opaque ? 3 : 4;
  const raw = Buffer.alloc(h * (w * bpp + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * bpp + 1)] = 0;
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const c = pixel((x + (sx + 0.5) / S) / w, (y + (sy + 0.5) / S) / h);
        if (c) { const ca = c[3] === undefined ? 1 : c[3]; r += c[0] * ca; g += c[1] * ca; b += c[2] * ca; a += ca; }
      }
      const o = y * (w * bpp + 1) + 1 + x * bpp;
      raw[o] = a ? r / a : 0; raw[o + 1] = a ? g / a : 0; raw[o + 2] = a ? b / a : 0;
      if (!opaque) raw[o + 3] = (a / (S * S)) * 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// ---- artwork (coordinates in the 512 x 512 space of brand/treehouse-mark.svg) ----
const NAVY = [5, 5, 31];
const STOPS = [[0, [255, 45, 155]], [0.5, [169, 92, 255]], [1, [18, 169, 255]]];
const lerp = (a, b, t) => a + (b - a) * t;
function gradAt(x, y) {   // the mark's gradient runs from (96, 70) to (420, 450)
  const dx = 324, dy = 380;
  let t = ((x - 96) * dx + (y - 70) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  const i = t <= 0.5 ? 0 : 1, [t0, c0] = STOPS[i], [t1, c1] = STOPS[i + 1], u = (t - t0) / (t1 - t0);
  return c0.map((v, k) => Math.round(lerp(v, c1[k], u)));
}
// Distance from (px, py) to the segment a-b.
function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}
const GAPS = [[232, 40, 232, 244], [280, 40, 280, 244], [256, 296, 96, 136], [256, 296, 416, 136], [190, 296, 96, 202], [322, 296, 416, 202]];
const ROOTS = [[256, 338, 256, 444], [250, 352, 188, 414], [262, 352, 324, 414], [176, 336, 142, 370], [336, 336, 370, 370]];
// The mark's colour at (x, y), or null where it's empty.
function mark(x, y) {
  const inDome = y <= 296 && x >= 106 && x <= 406 && (y >= 216 || (x - 256) ** 2 + (y - 216) ** 2 <= 150 * 150);
  if (inDome) {
    const cut = GAPS.some(([ax, ay, bx, by]) => {
      if (ax === bx) return Math.abs(x - ax) <= 8 && y >= ay && y <= by;   // straight cuts end square
      return segDist(x, y, ax, ay, bx, by) <= 8;
    });
    if (!cut) return gradAt(x, y);
  }
  // ground line (rounded ends)
  if (y >= 310 && y <= 324 && segDist(x, y, 113, 317, 399, 317) <= 7) return gradAt(x, y);
  if (ROOTS.some(([ax, ay, bx, by]) => segDist(x, y, ax, ay, bx, by) <= 8)) return gradAt(x, y);
  return null;
}
// The mark (artwork 106..406 wide, 66..444 tall) scaled to `scale` of the tile and centred.
const ART_CX = 256, ART_CY = 255, ART_H = 380;
function markOn(bg, scale) {
  return (u, v) => mark(ART_CX + (u - 0.5) * ART_H / scale, ART_CY + (v - 0.5) * ART_H / scale) || bg;
}
const full = markOn(NAVY, 0.64);

// ---- legacy icons (square and round) ----------------------------------------
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, m] of Object.entries(DENSITIES)) {
  const legacy = Math.round(48 * m), adaptive = Math.round(108 * m);
  writePng(path.join(RES, `mipmap-${d}`, 'ic_launcher.png'), legacy, legacy, (u, v) => {
    // rounded square, as on older launchers
    const r = 0.18, cx = Math.min(Math.max(u, r), 1 - r), cy = Math.min(Math.max(v, r), 1 - r);
    return (u - cx) ** 2 + (v - cy) ** 2 <= r * r ? full(u, v) : null;
  });
  writePng(path.join(RES, `mipmap-${d}`, 'ic_launcher_round.png'), legacy, legacy,
    (u, v) => ((u - 0.5) ** 2 + (v - 0.5) ** 2 <= 0.25 ? full(u, v) : null));
  // Adaptive icon: navy background layer + the mark as the foreground, kept inside the 66% safe zone.
  writePng(path.join(RES, `mipmap-${d}`, 'ic_launcher_background.png'), adaptive, adaptive, () => NAVY);
  // Foreground layer: the mark inside the 66% safe zone (transparent around it).
  writePng(path.join(RES, `mipmap-${d}`, 'ic_launcher_foreground.png'), adaptive, adaptive, markOn(null, 0.5));
}

// ---- splash screens (replace Capacitor's placeholder) -------------------------
function splash(file, opts) {
  const out = execSize(file);
  if (!out) return;
  const [w, h] = out;
  const side = Math.min(w, h) * 0.3;   // the mark's height on the splash
  writePng(file, w, h, (u, v) => {
    const x = ART_CX + (u * w - w / 2) / side * ART_H, y = ART_CY + (v * h - h / 2) / side * ART_H;
    return mark(x, y) || NAVY;
  }, opts);
}
function execSize(file) {
  try {
    const buf = fs.readFileSync(file);
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  } catch { return null; }
}
for (const dir of fs.readdirSync(RES).filter((d) => d.startsWith('drawable'))) {
  const f = path.join(RES, dir, 'splash.png');
  if (fs.existsSync(f)) splash(f);
}
// ---- iOS (only if the iOS project has been added: npx cap add ios) ------------------------------
const IOS = path.join(__dirname, '..', 'ios', 'App', 'App', 'Assets.xcassets');
if (fs.existsSync(IOS)) {
  // One 1024 x 1024 icon; iOS rounds the corners itself, so the artwork fills the square.
  writePng(path.join(IOS, 'AppIcon.appiconset', 'AppIcon-512@2x.png'), 1024, 1024, full, { opaque: true });
  // Splash images are large: one sample per pixel is plenty.
  for (const f of fs.readdirSync(path.join(IOS, 'Splash.imageset')).filter((n) => n.endsWith('.png'))) {
    splash(path.join(IOS, 'Splash.imageset', f), { opaque: true, S: 1 });
  }
}
// ---- website (anon-inbox/public) ------------------------------------------------------------------
const WEB = path.join(__dirname, '..', '..', 'anon-inbox', 'public');
if (fs.existsSync(WEB)) {
  for (const size of [180, 192, 512]) writePng(path.join(WEB, `icon-${size}.png`), size, size, full, { opaque: true });
  // Android notification badge: a white silhouette on transparent (the system tints it).
  const white = (u, v) => (mark(ART_CX + (u - 0.5) * ART_H / 0.9, ART_CY + (v - 0.5) * ART_H / 0.9) ? [255, 255, 255] : null);
  writePng(path.join(WEB, 'notif-badge.png'), 96, 96, white);
}
console.log('icons and splash screens written');
