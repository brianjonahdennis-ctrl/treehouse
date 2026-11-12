// Story images (1080x1920) shared by the owner app and members' inboxes.
// Card: holographic prompt strip + white message box, on the brand gradient.

function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
      else line = test;
    }
    lines.push(line);
  }
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function gradient(ctx, x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, '#ff2d9b');
  g.addColorStop(0.5, '#a95cff');
  g.addColorStop(1, '#12a9ff');
  return g;
}

// Largest font size (stepping down from maxSize) at which the text fits inside maxW x maxH.
function fitBox(ctx, text, maxW, maxH, maxSize, minSize, weight, lineHeight) {
  for (let size = maxSize; size >= minSize; size -= 2) {
    ctx.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
    const lines = wrapLines(ctx, text, maxW);
    const fitsWide = lines.every((l) => ctx.measureText(l).width <= maxW);
    if (fitsWide && lines.length * size * lineHeight <= maxH) return { size, lines, lineHeight };
  }
  ctx.font = `${weight} ${minSize}px Inter, system-ui, sans-serif`;
  const max = Math.max(1, Math.floor(maxH / (minSize * lineHeight)));
  const lines = wrapLines(ctx, text, maxW).slice(0, max);
  lines[max - 1] = lines[max - 1].replace(/\s*\S*$/, '') + '…';
  return { size: minSize, lines, lineHeight };
}

// Draws fitted text centred inside a box, optionally with a solid offset shadow.
function drawFitted(ctx, fit, weight, color, cx, top, height, shadowColor) {
  const blockH = fit.lines.length * fit.size * fit.lineHeight;
  const y0 = top + (height - blockH) / 2 + (fit.size * (fit.lineHeight - 1)) / 2;
  ctx.font = `${weight} ${fit.size}px Inter, system-ui, sans-serif`;
  const pass = (fill, dx, dy) => {
    ctx.fillStyle = fill;
    fit.lines.forEach((line, i) => ctx.fillText(line, cx + dx, y0 + dy + i * fit.size * fit.lineHeight));
  };
  if (shadowColor) { const o = Math.max(3, Math.round(fit.size * 0.06)); pass(shadowColor, o, o); }
  pass(color, 0, 0);
}

// Pearly holographic fill with soft highlights and fine grain (matches --holo in the CSS).
function drawHolo(ctx, x, y, w, h) {
  const base = ctx.createLinearGradient(x, y + h, x + w, y);
  [['#9fdcff', 0], ['#f0a8ff', .2], ['#ffe9a0', .38], ['#a6eed8', .55], ['#d9b0ff', .74], ['#a8d4ff', 1]]
    .forEach(([c, t]) => base.addColorStop(t, c));
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  for (const [fx, fy, r, a] of [[.18, .35, .5, .6], [.78, .7, .4, .45], [.5, .1, .3, .3]]) {
    const g = ctx.createRadialGradient(x + w * fx, y + h * fy, 0, x + w * fx, y + h * fy, w * r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = ctx.createPattern(grainTile(), 'repeat');
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

// A small tile of random grain, made once and repeated (much faster than per-pixel noise).
let grain = null;
function grainTile() {
  if (grain) return grain;
  grain = document.createElement('canvas');
  grain.width = grain.height = 160;
  const g = grain.getContext('2d');
  const img = g.createImageData(160, 160);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 90;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return grain;
}

// `footer` is the link printed at the bottom (members get their own /u/ link).
async function drawStory({ prompt, text, sticker, footer }) {
  await Promise.all([
    document.fonts.load('800 60px Inter'),
    document.fonts.load('700 60px Inter'),
    document.fonts.load('600 60px Inter'),
    document.fonts.load('italic 900 60px Inter'),
  ]).catch(() => {});

  const W = 1080, H = 1920;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';

  ctx.fillStyle = gradient(ctx, 0, 0, W, H);
  ctx.fillRect(0, 0, W, H);

  // The card fills 70% of the image height.
  const CW = 940, CH = Math.round(H * 0.7);
  const X = (W - CW) / 2, Y = Math.round((H - CH) / 2) - 50;
  const IN = 60; // inner side padding

  // Header: the prompt, in pink italic on the holographic strip
  const head = fitBox(ctx, prompt, CW - IN * 2, 3 * 78 * 1.15, 78, 48, 'italic 900', 1.15);
  const headH = head.lines.length * head.size * head.lineHeight + 150;

  const msgH = CH - headH;

  ctx.save();
  ctx.shadowColor = 'rgba(20, 10, 60, .35)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 24;
  roundRect(ctx, X, Y, CW, CH, 64);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.restore();

  drawHolo(ctx, X, Y, CW, headH);
  ctx.save();
  roundRect(ctx, X, Y, CW, CH, 64);
  ctx.clip();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(X, Y + headH, CW, CH - headH);
  ctx.restore();
  // Round the holographic strip's top corners by painting the background back outside the card.
  ctx.save();
  ctx.beginPath();
  ctx.rect(X, Y, CW, headH);
  ctx.roundRect(X, Y, CW, CH, 64); // same path, so evenodd leaves just the corners
  ctx.clip('evenodd');
  ctx.fillStyle = gradient(ctx, 0, 0, W, H);
  ctx.fillRect(X, Y, CW, headH);
  ctx.restore();

  drawFitted(ctx, head, 'italic 900', '#e03fcf', W / 2, Y, headH, '#ffd23f');

  // Same idea as the inbox: the shorter the message, the bigger the text.
  const bodyText = sticker ? 'send me anonymous messages! 👇' : text;
  const body = fitBox(ctx, bodyText, CW - IN * 2, msgH - 110, 140, 36, 800, 1.18);
  drawFitted(ctx, body, 800, '#111111', W / 2, Y + headH, msgH);


  // Footer
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.font = '600 36px Inter, system-ui, sans-serif';
  ctx.fillText(sticker ? 'tap the link to send yours' : 'send me anonymous messages', W / 2, Y + CH + 80);
  ctx.font = '700 38px Inter, system-ui, sans-serif';
  ctx.fillText(footer || (/(^|\.)treehouse\.ng$/.test(location.hostname) ? 'tell.brianjonahdennis.com' : location.host), W / 2, Y + CH + 130);

  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
}

