/**
 * GET /api/ping — quick check that Vercel Functions are wired (not static-only deploy).
 */
module.exports = (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify({ ok: true, route: '/api/ping', hint: 'If this works but /api/scan 404s, check Vercel Root / Output settings (see go-live-audit/VERCEL.md).' }));
};
