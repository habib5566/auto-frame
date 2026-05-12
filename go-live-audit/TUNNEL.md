# Backend tunnel (frontend alag host par ho)

Agar checklist **Vercel / Netlify / static CDN** par hai, browser wahan se `localhost` ko call nahi kar sakta. Is liye **scan backend** ko apni machine par chalao aur **HTTPS tunnel** se public karo.

## 1) Tunnel + server ek saath

Repo root se:

```bash
npm run go-live:audit:tunnel
```

- Pehle **Go-Live Audit server** port **3940** par chalega.
- Phir **ngrok** (default) tunnel banega. Terminal / ngrok UI mein **https://….ngrok-free.app** jaisa URL — copy karo.  
  Agar ngrok pehli dafa ho to: [ngrok signup](https://dashboard.ngrok.com/) se authtoken lagao: `ngrok config add-authtoken …`

**localtunnel** use karna ho (ngrok ke bina):

```bash
set GO_LIVE_AUDIT_TUNNEL=localtunnel
npm run go-live:audit:tunnel
```

( PowerShell: `$env:GO_LIVE_AUDIT_TUNNEL='localtunnel'; npm run go-live:audit:tunnel` )

## 2) Hosted UI mein paste karo

Deployed checklist page par field **“Scan API base”** mein sirf tunnel ka **origin** likho, example:

`https://abcd-12-34-56-78.ngrok-free.app`

- **Trailing slash mat lagao**
- **`/api/scan` mat likho** — UI khud jod leta hai

Phir **Site URL** + **Run quick scan** normal use karo.

## 3) TLS / corporate proxy

Agar scan karte waqt certificate error aaye, server env (jahan tunnel chal raha hai):

`GO_LIVE_AUDIT_TLS_INSECURE=1` (sirf trusted network par, MITM risk samajh kar)

## 4) Cloudflare Tunnel (optional)

Agar tum pehle se `cloudflared` use karte ho:

```bash
npm run go-live:audit
```

dusri terminal:

```bash
cloudflared tunnel --url http://localhost:3940
```

Jo **https** URL mile, wohi **Scan API base** mein daalo.

## Note

Tunnel band hote hi public URL khatam — har session par naya URL mil sakta hai (ngrok free tier). Production ke liye **Vercel par poora project** (`api/scan` + build) behtar hai — `VERCEL.md` dekho.
