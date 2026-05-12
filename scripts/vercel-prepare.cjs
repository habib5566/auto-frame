/**
 * Copy Go-Live Audit static assets into repo-root `public/` for Vercel.
 * Run automatically via package.json "build" when deploying.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
console.log('[build] Node', process.version, '| cwd', process.cwd());

const src = path.join(root, 'go-live-audit', 'public');
const dest = path.join(root, 'public');

function listDirSafe(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return ['(cannot read)'];
  }
}

if (!fs.existsSync(src)) {
  console.error('[build] FAILED: missing folder:', src);
  console.error('[build] Repo root contents:', listDirSafe(root));
  if (fs.existsSync(path.join(root, 'go-live-audit'))) {
    console.error('[build] go-live-audit/ contents:', listDirSafe(path.join(root, 'go-live-audit')));
  } else {
    console.error('[build] go-live-audit/ does NOT exist — push the full Auto-frame folder to GitHub (see README).');
  }
  process.exit(1);
}

if (fs.existsSync(dest)) {
  fs.rmSync(dest, { recursive: true, force: true });
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.cpSync(src, dest, { recursive: true });
console.log('[build] copied go-live-audit/public → public/');

const coreSrc = path.join(__dirname, 'go-live-audit-core.js');
const coreDest = path.join(root, 'api', '_scan-core.js');
if (!fs.existsSync(coreSrc)) {
  console.error('[build] FAILED: missing file:', coreSrc);
  process.exit(1);
}
fs.mkdirSync(path.dirname(coreDest), { recursive: true });
fs.copyFileSync(coreSrc, coreDest);
console.log('[build] copied scripts/go-live-audit-core.js → api/_scan-core.js');
