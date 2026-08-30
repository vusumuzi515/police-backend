# Eswatini Police — Citizen + Admin

## Folders

| Folder | What it is |
|--------|------------|
| `citizen-mobile/` | Citizen Expo app (phone) |
| `police-admin/` | Communications admin dashboard (Vite) |
| `server.js` | Shared API (port 3000) |
| `data/` / `uploads/` | API database and media |

## Run

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
