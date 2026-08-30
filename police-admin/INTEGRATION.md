# Communications Admin — citizen app integration

## How data flows

```
Citizen mobile app  ──►  Police server (port 3000)  ◄──  Communications admin (port 5174)
```

| Citizen action | API endpoint | Admin screen |
|----------------|--------------|--------------|
| Report incident | `POST /api/reports` | **Citizen reports** + Live monitoring rail |
| Get Help (hold button) | `POST /api/citizen/emergency/panic` | **Live monitoring** map + session list |
| Read police notices | `GET /api/notices` | **Notice feed** (after Comms publishes) |
| Comms publishes notice | `POST /api/notices` | Sent from **Create notice → Publish live** |

## Setup (3 terminals)

### 1. Police server
```powershell
cd "c:\INTELLIGENCECENTER\POLICE APP"
npm start
```

### 2. Communications admin
```powershell
cd "c:\INTELLIGENCECENTER\POLICE APP\police-admin"
copy .env.example .env
npm run dev
```
Open http://localhost:5174 — login **MELU101** / **Melu123!**

### 3. Citizen mobile (phone)
```powershell
cd "c:\INTELLIGENCECENTER\POLICE APP\citizen-mobile"
copy .env.example .env
```
Set `EXPO_PUBLIC_API_URL=http://YOUR_PC_IP:3000` then `npm start`

## Admin pages

- **Live monitoring** — map, Get Help sessions, live stats
- **Citizen reports** — inbox, evidence links, mark in review / close
- **Notices** — create & publish to citizen app
