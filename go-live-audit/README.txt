Go-Live Master Checklist — local "live" link
============================================

1) From repo root:  npm run go-live:audit
2) In the browser:  http://localhost:3940  (open this URL — do not use file:// or /api/scan will fail)
3) Optional port:    GO_LIVE_AUDIT_PORT=3950 npm run go-live:audit
4) Leave "Auto-fill checklist after scan" enabled so Pass/Fail/Needs check/Not scored and [auto] notes fill each row.

HTTPS scan error "unable to verify certificate":
  GO_LIVE_AUDIT_TLS_INSECURE=1 npm run go-live:audit
  (Use only on trusted networks — understand MITM risk.)

Public URL options:
- Vercel (UI + /api/scan): see VERCEL.md — repo root api/scan.js + npm run build.
- Render (free https://….onrender.com): repo root render.yaml — see LIVE.md.
- Frontend-only on CDN + tunneled backend: npm run go-live:audit:tunnel — see TUNNEL.md, paste URL into "Scan API base" in the UI.
- Other hosts: run the Node server (Railway, Render, Fly.io, etc.).

The scan is shallow (one HTML page + robots.txt). Forms, inbox, approvals, Zendesk behaviour = manual / Playwright.
