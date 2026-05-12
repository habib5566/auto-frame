# Simple — free Vercel par UI + scan dono

Main tumhari jagah deploy **nahi** kar sakta (login / account tumhara hai). Tum **sirf yeh** karo:

## 1) GitHub
Poora **Automation-Framework** repo push ho (sirf `index.html` wala folder alag deploy mat karna).

## 2) Vercel
[vercel.com/new](https://vercel.com/new) → repo import.

## 3) Settings (yahan galati = scan 404)

| Field | Value |
|-------|--------|
| **Root Directory** | **Khali** |
| **Output Directory** | **Khali** — `public` mat likho |
| **Build Command** | `npm run build` |

## 4) Deploy
Deploy ke baad jo **https://….vercel.app** mile woh use karo.

## 5) Test
Browser: **`/api/ping`** — JSON `ok: true` aaye to API theek. Phir **Run quick scan**.

## 6) Login / protection
Agar site pehle **Vercel login** maange to **Settings → Deployment Protection** adjust karo, warna API block ho sakti hai.

---

Ziyada detail: **VERCEL.md**
