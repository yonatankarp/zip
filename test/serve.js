/*
 * Tiny static server for the built app. ES modules cannot be loaded over
 * file://, so the browser suite serves dist/ over HTTP the same way Pages does.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
};

export async function serve(root, port = 0) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // Strip any leading segment and refuse to escape the root.
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(root, rel.endsWith('/') ? `${rel}index.html` : rel);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  const { port: actual } = server.address();
  return {
    origin: `http://127.0.0.1:${actual}`,
    close: () => new Promise(resolve => server.close(resolve))
  };
}
