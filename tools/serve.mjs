// Tiny static file server for local preview and browser tests.
// No dependencies. Serves the repository root on 127.0.0.1 only.
//   node tools/serve.mjs            → http://localhost:8765/
//   PORT=9000 node tools/serve.mjs
// Also importable: `const { server, url } = await startServer({ port: 0 })`.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3':  'audio/mpeg',
  '.woff2': 'font/woff2',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/plain; charset=utf-8',
};

async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(ROOT, rel));
    // Refuse anything outside the repository and any dot-path (.git, .claude …)
    if (!file.startsWith(ROOT + sep) || rel.split('/').some(p => p.startsWith('.'))) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) { res.writeHead(404).end('not found'); return; }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    res.writeHead(500).end(String(err?.message || err));
  }
}

export function startServer({ port = 8765, host = '127.0.0.1' } = {}) {
  return new Promise((ok, fail) => {
    const server = createServer(handle);
    server.once('error', fail);
    server.listen(port, host, () => {
      const { port: p } = server.address();
      ok({ server, url: `http://localhost:${p}/` });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await startServer({ port: Number(process.env.PORT) || 8765 });
  console.log(`Lernplattform: ${url}  (Ctrl+C to stop)`);
}
