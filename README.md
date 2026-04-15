# TRINSIT NEMT Operations Web App

This is a full MVP-style web app for **TRINSIT** with:

- Role-based access: **admin, manager, dispatcher, driver, contractor driver**
- **Clock in / clock out / lunch out / lunch in** with GPS attendance capture
- **Live driver GPS updates** and a dispatcher/admin live map
- **Trip creation and assignment**
- **Trip pricing calculator** with admin-editable pricing rules
- **Vehicle inspections**
- **Equipment inventory**
- **Incident reporting**
- **Real-time team chat**
- **Notifications** for newly assigned trips
- Driver privacy rules so assigned drivers do **not** see **payer, DOB, or MRN**

## Stack

- Node.js + Express
- Socket.IO for real-time notifications/chat/GPS updates
- Vanilla JS frontend with Leaflet map
- Local JSON persistence for quick MVP/demo use

## Run locally

1. Install a current LTS version of Node.js (Node 20+ recommended).
2. Open a terminal in this folder.
3. Run:

```bash
npm install
npm start
```

4. Open `http://localhost:3000`

## Demo users

- `admin@trinsit.local` / `Admin123!`
- `manager@trinsit.local` / `Manager123!`
- `dispatcher@trinsit.local` / `Dispatcher123!`
- `driver@trinsit.local` / `Driver123!`
- `contractor@trinsit.local` / `Contract123!`

## Important production notes

This code is a strong MVP foundation, but before real deployment you should add:

- HTTPS everywhere for reliable mobile GPS/browser notifications
- A production database such as PostgreSQL
- Proper audit logs
- HIPAA/security review for patient data handling
- File uploads for trip documents/facesheets
- Better permissions and field-level auditing
- Push notifications via Firebase/APNs
- Mileage calculation from real routing APIs
- Password reset / MFA / device management
- Background job processing

## File structure

- `server.js` → API + realtime server
- `public/index.html` → app shell
- `public/app.js` → frontend logic
- `public/styles.css` → styling
- `public/logo.svg` → TRINSIT placeholder logo
- `data/*.json` → local persistence

## Next best upgrade path

- Move pricing, trips, attendance, inspections, chat, and incidents into PostgreSQL
- Add Supabase/Auth0/Clerk for authentication
- Add a mobile driver app or PWA
- Add payer billing exports and trip claims workflows
- Add dispatch drag-and-drop scheduling
