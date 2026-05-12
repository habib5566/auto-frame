# Auto frame — Go-Live Checklist (standalone)

Checklist UI + **`POST /api/scan`** + Vercel / Render files. Git push ke **baad** live karne ke liye neeche **step-by-step** follow karo.

---

## Pehle local test (optional)

```bash
cd Auto-frame
npm install
npm run go-live:audit
```

Browser: **http://localhost:3940** → **Site URL** daal kar **Run quick scan**.  
**Scan API base** yahan **khali** chhodo.

---

## Vercel par deploy — step by step (recommended, free)

### Step 1 — GitHub
Repo pe code push ho chuka ho (sirf `Auto-frame` wala project).

### Step 2 — Vercel project
1. [vercel.com](https://vercel.com) par login karo.  
2. **Add New…** → **Project**.  
3. **Import** apna GitHub repo (jisme `Auto-frame` code hai).

### Step 3 — Root folder (zaroori)
Agar GitHub repo ka **root** hi `Auto-frame` content hai → **Root Directory khali** chhodo.

Agar poora `Automation-Framework` repo import kiya hai aur checklist `Auto-frame/` ke **andar** hai → **Root Directory** mein likho: **`Auto-frame`**

### Step 4 — Build settings (zaroori — yahi scan 404 rokta hai)

| Field | Value |
|--------|--------|
| **Framework Preset** | **Other** |
| **Root Directory** | Khali **ya** `Auto-frame` (jo upar bola) |
| **Build Command** | `npm run build` |
| **Output Directory** | **Khali** — `public` **mat** likho |
| **Install Command** | default (`npm install`) theek |

### Step 5 — Environment variable (sirf zarurat par)
- Agar scan karte waqt **TLS / certificate** error aaye (corporate SSL):  
  **Settings → Environment Variables** →  
  `GO_LIVE_AUDIT_TLS_INSECURE` = `1` (Production + Preview dono par agar chaho)  
  **Warning:** sirf trusted network; MITM risk samajh kar.

### Step 6 — Deploy
**Deploy** dabao. Wait until **Ready**.

#### Build fail ho to (common)
- **Build Logs** scroll karke **pehli error line** dekho.  
- Agar **`missing folder: .../go-live-audit/public`** aaye → GitHub repo mein **`go-live-audit/public/index.html`** push nahi hua. Local: `git add go-live-audit` → `commit` → `push`.  
- Vercel **Settings → General → Node.js Version** → **20.x** select karo (engines bhi `20.x` hai).

### Step 7 — API test (pehle yeh)
Browser mein kholo:

`https://tumhari-deployment.vercel.app/api/ping`

- **JSON** mein `"ok":true` dikhe → backend theek.  
- **404** → Step 3–4 dubara check karo (Root / Output).

### Step 8 — Deployment protection
Agar **login** maangta ho aur scan fail ho:

**Project → Settings → Deployment Protection** — preview/production ke hisaab se adjust karo taake **bina extra auth** `POST /api/scan` chal sake (ya **Production** URL use karo).

### Step 9 — App use
1. `https://….vercel.app` kholo.  
2. **Scan API base** → **khali** (same host par API hai).  
3. **Site URL** → public `https://…` site.  
4. **Run quick scan** → checklist auto-fill ho sakti hai.

---

## Render (free, agar Vercel tang kare)

1. [render.com](https://render.com) → **New** → **Blueprint**.  
2. Wahi GitHub repo connect karo (root mein `render.yaml` ho).  
3. Agar monorepo hai to Render mein **Root Directory** `Auto-frame` set karo jahan `render.yaml` / `package.json` ho.  
4. Deploy → **`https://….onrender.com`** milega — wahan bhi **Scan API base khali**.

Detail: `go-live-audit/LIVE.md`

---

## Docs (is repo ke andar)

| File | Topic |
|------|--------|
| `go-live-audit/DEPLOY-SIMPLE.md` | Vercel short checklist |
| `go-live-audit/VERCEL.md` | 404 fix, protection, detail |
| `go-live-audit/TUNNEL.md` | Sirf UI alag ho to tunnel + Scan API base |
| `go-live-audit/LIVE.md` | Render + options |

---

## Files layout

| Path | Role |
|------|------|
| `go-live-audit/public/` | UI (`index.html`) |
| `api/scan.js`, `api/ping.js` | Vercel serverless |
| `scripts/go-live-audit-core.js` | Scan logic |
| `scripts/go-live-audit-server.js` | Local server |
| `scripts/vercel-prepare.cjs` | `npm run build` → `public/` + `api/_scan-core.js` |
| `vercel.json`, `render.yaml` | Deploy |

---

*Standalone copy for clean Git + deploy.*
