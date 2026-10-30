// Local preview without installing a package: node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
const port = Number(process.argv[2] || 8083);
createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/__preview') {
      if (req.headers.origin !== `http://127.0.0.1:${port}`) throw new Error('Local preview only');
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 5e6) throw new Error('Image too large'); chunks.push(chunk); }
      const png = Buffer.concat(chunks);
      if (png.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') throw new Error('PNG required');
      await writeFile(resolve(root,'preview.png'),png); res.writeHead(200); res.end('Saved'); return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new Error('Unsupported method');
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let path = resolve(root, '.' + pathname);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) throw new Error('Outside preview');
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Preview http://127.0.0.1:${port}/docs/`));
