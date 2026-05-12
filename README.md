# Auto frame — Go-Live Checklist (standalone)

Yeh folder **poora alag mini-project** hai: checklist UI + `POST /api/scan` + Vercel/Render deploy files.  
Bade `Automation-Framework` repo ke bina isko **sirf is folder se** GitHub par daal sakte ho (repo naam GitHub par `Auto-frame` / `auto-frame` jo marzi).

## Local chalana

```bash
npm install
npm run go-live:audit
```

Browser: **http://localhost:3940** — **Scan API base** khali chhodo.

## GitHub (sirf yeh folder)

```bash
cd Auto-frame
git init
git add .
git commit -m "Initial: Go-Live checklist"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

## Live (free)

- **Vercel:** `go-live-audit/DEPLOY-SIMPLE.md` aur `go-live-audit/VERCEL.md`  
- **Render:** root par `render.yaml` — `go-live-audit/LIVE.md`

## Files layout

| Path | Role |
|------|------|
| `go-live-audit/public/` | Static UI (`index.html`) |
| `api/scan.js`, `api/ping.js` | Vercel serverless |
| `scripts/go-live-audit-core.js` | Scan logic (local + Vercel build copies slice into `api/`) |
| `scripts/go-live-audit-server.js` | Local Node server |
| `scripts/vercel-prepare.cjs` | `npm run build` → `public/` + `api/_scan-core.js` |
| `vercel.json`, `render.yaml` | Deploy config |

---

*Copied from Automation-Framework for a clean deploy-only repo.*
