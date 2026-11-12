// Local design preview for the treehouse app (/home) with sample data and no real database.
// Serves public/ as-is, but swaps the Supabase client for dev/mock-supabase.js.
// Not deployed: the Dockerfile only copies server.js, push.js and public/.
//   PORT=4010 node dev/mock-server.mjs   → http://localhost:4010/home
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = url.pathname;
  try {
    if (p === '/api/dating-config') return send(res, 200, 'application/json', JSON.stringify({ ready: true, enabled: true, url: 'mock', key: 'mock' }));
    // Speed Dating in the preview: switched on, no relay (two tabs on this computer connect directly).
    if (p === '/api/speed-config') return send(res, 200, 'application/json', JSON.stringify({ enabled: true, relay: false }));
    if (p === '/api/speed-ice') return send(res, 200, 'application/json', JSON.stringify({ iceServers: [], relay: false }));
    if (p.startsWith('/api/')) return send(res, 404, 'application/json', '{}');
    if (p === '/supabase.js') return send(res, 200, 'text/javascript', await readFile(join(here, 'mock-supabase.js')));
    if (p === '/home' || p.startsWith('/home/')) p = '/home.html';
    if (p === '/') p = '/home.html';
    const file = join(pub, p);
    if (!file.startsWith(pub)) return send(res, 403, 'text/plain', 'no');
    send(res, 200, TYPES[extname(file)] || 'application/octet-stream', await readFile(file));
  } catch { send(res, 404, 'text/plain', 'not found'); }
}).listen(Number(process.env.PORT) || 4010);

function send(res, code, type, body) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}
