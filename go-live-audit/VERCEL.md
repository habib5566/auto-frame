# Deploy Go-Live Audit on Vercel

This repo serves the checklist UI from `public/` (copied at build time from `go-live-audit/public`) and runs **`POST /api/scan`** as a serverless function (`api/scan.js`).

## Fix “Error: 404” on Run quick scan

Almost always **Vercel project settings**, not the code:

| Setting | Correct value |
|--------|----------------|
| **Root Directory** | **Empty** (repo root). Not `go-live-audit`, not `go-live-audit/public`, not `public`. |
| **Output Directory** | **Empty**. If you set `public`, Vercel often deploys **static-only** and **`/api/*` returns 404**. |
| **Framework Preset** | **Other** (or “Other” with no framework auto-detect overriding output). |
| **Build Command** | `npm run build` |

After fixing, **Redeploy**. Quick test in the browser: open **`/api/ping`** — you should see JSON `{"ok":true,...}`. If `/api/ping` is also 404, the Functions layer is still not deployed (check Root / Output again).

Build copies scan logic into **`api/_scan-core.js`** (generated, gitignored) so the serverless bundle includes all Node code.

## Steps

1. Push this repo to GitHub (or use Vercel CLI with this folder).
2. In [Vercel](https://vercel.com) → **Add New Project** → import the repo.
3. Use defaults: **Build Command** `npm run build`, **Output** is automatic (static `public/` + `api/`).
4. Deploy. Your live URL will look like `https://<project>.vercel.app`.

## Deployment Protection (login before site opens)

If the browser asks for **Vercel login** on preview URLs, **`POST /api/scan` is also blocked** — the checklist cannot scan.

- **Project** → **Settings** → **Deployment Protection** → allow public access for the environments you use, **or**
- Use the **Production** domain (often no protection), **or**
- Add **Protection Bypass for Automation** (Vercel docs) if you must keep protection on.

Without this, the UI may load after you log in, but **Run quick scan** will still fail until the API is reachable without auth.

## Environment variables (optional)

| Variable | When |
|----------|------|
| `GO_LIVE_AUDIT_TLS_INSECURE=1` | Only if outbound scans hit TLS verify errors you accept (MITM risk on untrusted networks). |

## After deploy

Open your Vercel URL, enter a **public** `https://…` site, and run **Run quick scan**.  
Same-origin `fetch('/api/scan')` works on Vercel.

## Static UI only + tunnel backend

If you deployed **only** the HTML (no `api/scan` on Vercel), run on your PC:

`npm run go-live:audit:tunnel`

Then in the checklist page set **Scan API base** to the tunnel `https://…` URL. Details: **TUNNEL.md**.

## Note

We cannot create the link for you — it is tied to **your** Vercel account and project name. After the first successful deploy, copy the **Production** URL from the Vercel dashboard.
