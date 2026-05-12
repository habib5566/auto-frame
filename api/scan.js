/**
 * Vercel serverless: POST /api/scan
 * Body: { "url": "https://example.com" }
 */
const { handleScan, sendJson } = require('./_scan-core.js');

module.exports = async (req, res) => {
  try {
    await handleScan(req, res);
  } catch (err) {
    sendJson(res, 500, { error: String(err && err.message ? err.message : err) });
  }
};
