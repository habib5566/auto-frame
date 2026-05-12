/**
 * Copy Go-Live Audit static assets into repo-root `public/` for Vercel.
 * Run automatically via package.json "build" when deploying.
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'go-live-audit', 'public');
const dest = path.join(__dirname, '..', 'public');

if (!fs.existsSync(src)) {
  console.error('Missing source:', src);
  process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log('Vercel: copied go-live-audit/public → public/');

/** Serverless bundle only traces `api/` — copy scan core next to `api/scan.js` for Vercel. */
const coreSrc = path.join(__dirname, 'go-live-audit-core.js');
const coreDest = path.join(__dirname, '..', 'api', '_scan-core.js');
if (!fs.existsSync(coreSrc)) {
  console.error('Missing scan core:', coreSrc);
  process.exit(1);
}
fs.copyFileSync(coreSrc, coreDest);
console.log('Vercel: copied scripts/go-live-audit-core.js → api/_scan-core.js');
