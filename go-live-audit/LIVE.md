# Live URL (perfect UI + scan — same origin)

Main tumhare naam par deploy nahi kar sakta; **link tumhare account** se banti hai. Neeche sab se seedha tareeqa:

---

## Option A — Vercel (recommended if you already use it)

1. GitHub par **poora** `Automation-Framework` repo push karo (sirf `index.html` folder mat — chahiye `api/scan.js`, `vercel.json`, `package.json`).
2. [vercel.com/new](https://vercel.com/new) → repo import → **Deploy** (build: `npm run build`).
3. Jo **`https://<project>.vercel.app`** mile — wohi **final link**. Page par **Scan API base khali** chhodo.

Ziyada detail: **VERCEL.md**.

---

## Option B — Render (free `.onrender.com` link, poora Node server)

1. Repo GitHub par push karo.
2. [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint** → repo select.
3. Root mein **`render.yaml`** pick ho jayega → **Apply**.
4. Deploy complete hone par **`https://go-live-audit-xxxx.onrender.com`** jaisi link milegi — **UI + `/api/scan` dono yahi** chalenge. **Scan API base khali** rakho.

Optional env: `GO_LIVE_AUDIT_TLS_INSECURE=1` agar scan par TLS verify error aaye (sirf trusted network).

---

## Option C — Sirf laptop (no public link)

```bash
npm run go-live:audit
```

Browser: **http://localhost:3940**

---

## Galati jo aksar hoti hai

- Vercel par **sirf frontend** files daali → scan fail / “could not finish” → **poora repo** deploy karo **ya** tunnel + **Scan API base** (**TUNNEL.md**).

---

**Seedhi baat:** “Live link” = **Vercel** ya **Render** deploy ke baad jo URL dashboard dikhata hai — woh copy karo; main us URL ko generate nahi kar sakta bina tumhare account ke.
