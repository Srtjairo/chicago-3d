// Builds the public GitHub Pages copy into docs/.
// index.html stays wrapper-less for the claude.ai artifact publisher; this adds the
// doctype, <html>/<head>/<body> and link-preview tags, and copies js/ and preview.png.
//
//   node tools/build-site.mjs https://<user>.github.io/chicago-3d/

import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs');
const siteUrl = (process.argv[2] || '').replace(/\/?$/, '/');
if (!/^https:\/\//.test(siteUrl)) {
  console.error('Usage: node tools/build-site.mjs https://<user>.github.io/<repo>/');
  process.exit(1);
}

const TITLE = 'Downtown Chicago in 3D';
const DESC = 'Fly around a 3D model of downtown Chicago: Willis Tower, the Hancock, Grant Park, the river and Navy Pier, from midday to night, with a guided tour.';

const src = readFileSync(join(root, 'index.html'), 'utf8');
const scripts = readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js')).sort();
const hash = createHash('sha256').update(src);
for (const f of scripts) hash.update(f).update(readFileSync(join(root, 'js', f)));
if (existsSync(join(root, 'preview.png'))) hash.update(readFileSync(join(root, 'preview.png')));
const revision = hash.digest('hex').slice(0, 16);
// Everything up to the first <canvas> is head material (title, meta, fonts, style, importmap).
const split = src.indexOf('<canvas');
if (split < 0) throw new Error('index.html: no <canvas> found to split head from body');
const head = src.slice(0, split).trimEnd();
const body = src.slice(split).trim().replace('src="js/main.js"', `src="js/main.js?v=${revision}"`);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const meta = [
  `<meta charset="utf-8">`,
  `<meta name="description" content="${esc(DESC)}">`,
  `<meta name="theme-color" content="#0b0f17">`,
  `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 20 20"><path fill="#e4002b" d="M0-9 2-3.5 7.8-4.5 4-0 7.8 4.5 2 3.5 0 9-2 3.5-7.8 4.5-4 0-7.8-4.5-2-3.5z"/></svg>')}">`,
  `<meta property="og:type" content="website">`,
  `<meta property="og:title" content="${esc(TITLE)}">`,
  `<meta property="og:description" content="${esc(DESC)}">`,
  `<meta property="og:url" content="${siteUrl}">`,
  `<meta property="og:image" content="${siteUrl}preview.png?v=${revision}">`,
  `<meta property="og:image:width" content="1200">`,
  `<meta property="og:image:height" content="630">`,
  `<meta name="twitter:card" content="summary_large_image">`,
  `<meta name="twitter:title" content="${esc(TITLE)}">`,
  `<meta name="twitter:description" content="${esc(DESC)}">`,
  `<meta name="twitter:image" content="${siteUrl}preview.png?v=${revision}">`,
].join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
${meta}
${head}
</head>
<body>
${body}
</body>
</html>
`;

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'js'), { recursive: true });
writeFileSync(join(out, 'index.html'), html);
for (const f of scripts) {
  // A page reload gets one consistent release even when older modules are cached.
  const code = readFileSync(join(root, 'js', f), 'utf8').replace(/from (['"])(\.\/[^'"]+\.js)\1/g,
    (_, quote, path) => `from ${quote}${path}?v=${revision}${quote}`);
  writeFileSync(join(out, 'js', f), code);
}
if (existsSync(join(root, 'preview.png'))) copyFileSync(join(root, 'preview.png'), join(out, 'preview.png'));
else console.warn('warning: preview.png missing, link previews will have no image');
writeFileSync(join(out, '.nojekyll'), '');
writeFileSync(join(out, 'revision.json'), JSON.stringify({ revision }) + '\n');
console.log(`Built docs/ for ${siteUrl} (revision ${revision})`);
