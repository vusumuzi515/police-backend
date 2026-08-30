# Police Eswatini — Communications Admin

**Separate web app** for the Communications Department. It does **not** run inside `citizen-mobile` (Expo).

All admin code stays in **`police-admin/`** only — never in `citizen-mobile/`.

## Folder

```
POLICE APP/
  citizen-mobile/     ← citizen phone app (Expo)
  police-admin/       ← this app (browser only)
  server.js           ← shared API (port 3000)
```

See also: `../PROJECT-STRUCTURE.md` and `../police-ecosystem.code-workspace`.

## Option A — Dev mode (recommended while building UI)

Open a **new terminal** (not the Expo one):

```powershell
cd "c:\INTELLIGENCECENTER\POLICE APP\police-admin"
npm install
npm run dev
```

Browser opens at: **http://localhost:5174/**

Click **Sign in** (demo — any password works in preview mode).

## Option B — Via main police server (after build)

```powershell
cd "c:\INTELLIGENCECENTER\POLICE APP\police-admin"
npm run build

cd ..
npm start
```

Open: **http://localhost:3000/communications/**

## What you can do

| Screen | Purpose |
|--------|---------|
| Dashboard | Live notice counts |
| All notices | Draft / published / archived |
| Create notice | Form + mobile preview |
| Live view | What citizens would see |

Data is stored in your browser (localStorage) until connected to the API.

## API (later)

Point to the main server: `http://localhost:3000`  
Notices endpoint: `GET /api/notices` · `POST /api/notices` (auth required)

Default command-centre login on main server: badge `MELU101`, password `Melu123!`
