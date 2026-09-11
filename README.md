# Eswatini Police — Citizen + Admin

The **backend is the POLICE APP folder itself** (not `citizen-mobile`).  
Host this on Render: `server.js` at the repo root, start with `node server.js`.

## Folders

| Path | What it is |
|------|------------|
| `server.js` | **API to host** (this is the backend) |
| `package.json` | `npm start` → `node server.js` |
| `data/` | Local cache / development fallback; production state is stored in Supabase |
| `uploads/` | Photos / audio |
| `citizen-mobile/` | Phone app — do **not** set this as Render root |
| `police-admin/` | Dashboard — run locally or build separately |

## Host on Render (new Web Service)

1. On GitHub, create repo **`police-backend`** (empty, no README) if it does not exist.
2. Push this folder:

```powershell
cd "C:\INTELLIGENCECENTER\POLICE APP"
git push origin master
```

3. Render → **New +** → **Web Service** (not Static Site).
4. Connect GitHub repo **`vusumuzi515/police-backend`**.
5. Settings:

| Field | Value |
|--------|--------|
| Name | `police-biso` (or any name — copy the `.onrender.com` URL) |
| Branch | `master` |
| Root Directory | **leave empty** |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `node server.js` |

6. Create Web Service → wait until logs show `API: http://localhost:.../`
7. Open `https://YOUR-SERVICE.onrender.com/` — you should see **Eswatini Police API**.

Paste that URL into `citizen-mobile/.env` and `eas.json` as `EXPO_PUBLIC_API_URL`, then rebuild the APK.

Free Render apps sleep after idle; the first request can take ~1 minute.

## Connect Supabase

Run `supabase-distress-sessions.sql` in the Supabase SQL Editor before deploying. It creates the durable `police_app_state` table used by the API and enables row-level security.

In the Render service environment, set these secret variables:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

The API loads its state from Supabase before accepting requests and writes changes back to Supabase. In production it will refuse to start if either variable is missing or if the state table cannot be read.

Never put `SUPABASE_SERVICE_ROLE_KEY` in the citizen app or the Netlify dashboard.

## Run locally

### 1. API (required)

```bash
cd "POLICE APP"
npm install
npm start
```

API: http://localhost:3000

### 2. Admin dashboard

```bash
cd police-admin
npm install
npm run dev
```

Open http://localhost:5174  
Login: username `MELU101` / password `Melu123!`

Or from the root folder: `npm run admin:dev`

### 3. Citizen app

```bash
cd citizen-mobile
npm install
npm start
```

Set `citizen-mobile/.env` to your PC Wi‑Fi IP (phones cannot use `localhost`):

```
EXPO_PUBLIC_API_URL=http://192.168.x.x:3000
```

## Production admin build

```bash
npm run admin:build
npm start
```

Then open http://localhost:3000/communications/
