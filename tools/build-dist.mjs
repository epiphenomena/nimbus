// Build dist/, the static files the Worker serves: an allowlist, so nothing
// else in the project (tools, Rakefile, wrangler.toml, .dev.vars, node_modules)
// can be published. The app's name comes from app.json: {{NAME}} and {{ID}}
// in the text files below are replaced with it.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));

const FILES = ['index.html', 'manifest.webmanifest', 'sw.js'];
const DIRS = ['css', 'js', 'icons', 'vendor'];
const TEMPLATED = /\.(html|webmanifest|js|css)$/;

// Emptied in place rather than replaced, so a running `wrangler dev` keeps
// watching the same directory.
fs.mkdirSync(dist, { recursive: true });
for (const e of fs.readdirSync(dist)) fs.rmSync(path.join(dist, e), { recursive: true, force: true });
for (const f of FILES) fs.copyFileSync(path.join(root, f), path.join(dist, f));
for (const d of DIRS) fs.cpSync(path.join(root, d), path.join(dist, d), { recursive: true });

let n = 0;
const walk = d => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    n++;
    if (TEMPLATED.test(e.name) && !p.includes(`${path.sep}vendor${path.sep}`)) {
      const s = fs.readFileSync(p, 'utf8');
      if (s.includes('{{')) fs.writeFileSync(p, s.replaceAll('{{NAME}}', app.name).replaceAll('{{ID}}', app.id));
    }
  }
};
walk(dist);
console.log(`dist/: ${n} files (${app.name})`);
