const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');
let google = null;
try { google = require('googleapis').google; } catch {}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-trinsit';
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function ensureFile(name, initialValue) {
  ensureDir(DATA_DIR); ensureDir(UPLOAD_DIR);
  const filePath = path.join(DATA_DIR, name);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, JSON.stringify(initialValue, null, 2));
}
function readJson(name) { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')); }
function writeJson(name, value) { fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(value, null, 2)); }
function nowIso() { return new Date().toISOString(); }
function normalizeEmail(v) { return String(v || '').trim().toLowerCase(); }
function titleCase(v) { return String(v || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function maskUser(user) { const { passwordHash, pinHash, loginCodeHash, ...safe } = user; return safe; }
function normalizePasscode(v) { return String(v || '').trim(); }
function isLoginCodeUnique(users, code, exceptUserId='') { return !users.some(u => u.id !== exceptUserId && u.loginCodeHash && bcrypt.compareSync(code, u.loginCodeHash)); }
async function geocodeAddress(address) { const q = encodeURIComponent(String(address||'').trim()); if (!q) return null; const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${q}`, { headers: { 'User-Agent': 'TRINSIT/1.0' } }); if (!res.ok) return null; const data = await res.json(); if (!data[0]) return null; return { lat: Number(data[0].lat), lon: Number(data[0].lon), display_name: data[0].display_name }; }
async function suggestAddresses(query) { const q = encodeURIComponent(String(query||'').trim()); if (!q) return []; const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${q}`, { headers: { 'User-Agent': 'TRINSIT/1.0' } }); if (!res.ok) return []; return await res.json(); }
async function routeMileage(fromAddress, toAddress) { const from = await geocodeAddress(fromAddress); const to = await geocodeAddress(toAddress); if (!from || !to) return { miles: 0, from, to }; const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`; const res = await fetch(url); if (!res.ok) return { miles: 0, from, to }; const data = await res.json(); const meters = data.routes?.[0]?.distance || 0; return { miles: meters / 1609.34, from, to }; }

function ymd(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0,10);
}
function collectUploadsForDate(targetDate) {
  const items = [];
  const addFile = (meta, info={}) => {
    if (!meta || !meta.localUrl || ymd(meta.uploadedAt || info.createdAt) !== targetDate) return;
    const basename = path.basename(meta.localUrl || '');
    const localPath = path.join(UPLOAD_DIR, basename);
    if (!fs.existsSync(localPath)) return;
    items.push({
      filePath: localPath,
      archiveName: `${info.folder || 'documents'}/${basename}-${String(meta.originalName || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')}` ,
      manifest: {
        originalName: meta.originalName || basename,
        uploadedAt: meta.uploadedAt || info.createdAt || '',
        sourceType: info.sourceType || '',
        sourceId: info.sourceId || '',
        userName: info.userName || '',
        note: info.note || '',
        storage: meta.storage || 'local'
      }
    });
  };

  for (const u of readJson('users.json')) addFile(u.identityFile, { folder: 'profile_ids', sourceType: 'user_profile', sourceId: u.id, userName: u.name, createdAt: u.identityFile?.uploadedAt, note: 'Profile ID / license' });
  for (const t of readJson('trips.json')) for (const f of (t.facesheetFiles || [])) addFile(f, { folder: 'trip_facesheets', sourceType: 'trip_facesheet', sourceId: t.id, userName: t.patientName, createdAt: f.uploadedAt, note: t.tripNumber || '' });
  for (const e of readJson('expenses.json')) addFile(e.receipt, { folder: 'expense_receipts', sourceType: 'expense_receipt', sourceId: e.id, userName: e.userName, createdAt: e.receipt?.uploadedAt, note: e.category || '' });
  for (const i of readJson('incidents.json')) for (const f of (i.images || [])) addFile(f, { folder: 'incident_images', sourceType: 'incident_image', sourceId: i.id, userName: i.userName, createdAt: f.uploadedAt, note: i.whatToReport || '' });
  for (const i of readJson('inspections.json')) for (const f of (i.images || [])) addFile(f, { folder: 'inspection_images', sourceType: 'inspection_image', sourceId: i.id, userName: i.userName, createdAt: f.uploadedAt, note: i.vehicleNumber || '' });
  for (const eq of readJson('equipment.json')) for (const entry of (eq.checkEntries || [])) for (const f of (entry.images || [])) addFile(f, { folder: 'equipment_checks', sourceType: 'equipment_check', sourceId: eq.id, userName: entry.userName, createdAt: f.uploadedAt, note: `${eq.name || ''} ${entry.status || ''}`.trim() });
  return items;
}

ensureFile('users.json', []);
ensureFile('trips.json', []);
ensureFile('attendance.json', []);
ensureFile('expenses.json', []);
ensureFile('inspections.json', []);
ensureFile('incidents.json', []);
ensureFile('equipment.json', []);
ensureFile('priceSettings.json', {
  services: { ambulatory: 60, wheelchair: 110, stretcher: 220, climbing_stairs_chair: 180, own_wheelchair: 95 },
  mileageTiers: [{ upTo: 10, rate: 0 }, { upTo: 39, rate: 4 }, { upTo: 99, rate: 5.5 }, { upTo: 9999, rate: 7.6 }],
  bariatricThreshold: 250,
  weightSurcharge: 140,
  oxygen: { base: 25, perLiter: 7 },
  extraStop: 40
});
ensureFile('gps.json', {});
ensureFile('notifications.json', []);
ensureFile('messages.json', []);
ensureFile('payers.json', ['Medicaid', 'Private Pay', 'Facility', 'Insurance']);
ensureFile('vehicles.json', []);
ensureFile('invoiceRuns.json', []);
ensureFile('channels.json', []);
ensureFile('featureSettings.json', { notificationsEnabled: true, commissionEnabled: true, mapEnabled: true });

function seedUsers() {
  const users = readJson('users.json');
  if (users.length) return;
  const demo = [
    ['Admin User','admin@trinsit.local','admin','001900!'],
    ['Manager User','manager@trinsit.local','manager','111112!'],
    ['Dispatcher User','dispatcher@trinsit.local','dispatcher','111113!'],
    ['Driver User','driver@trinsit.local','driver','111114!'],
    ['Contract Driver','contractor@trinsit.local','contractor_driver','111115!']
  ].map(([name,email,role,loginCode])=>(
    { id: uuidv4(), name, email, role, active: true, accountStatus: 'active', mustCompleteProfile: role !== 'admin', passwordHash: bcrypt.hashSync('legacy-password', 10), pinHash: bcrypt.hashSync(loginCode.slice(0,6), 10), loginCodeHash: bcrypt.hashSync(loginCode, 10), phone:'', dateOfBirth:'', certificate:'', address:'', identityFile:null, showCommissionPage: false, createdAt: nowIso(), updatedAt: nowIso() }
  ));
  writeJson('users.json', demo);
}
function ensureLoginCodes() {
  const users = readJson('users.json');
  let changed = false;
  users.forEach((u, i) => {
    if (!u.loginCodeHash) {
      const defaultCode = u.role === 'admin' ? '001900!' : `${String(111112 + i).slice(0,6)}!`;
      u.loginCodeHash = bcrypt.hashSync(defaultCode, 10);
      changed = true;
    }
  });
  users.forEach(u=>{ if (typeof u.showCommissionPage !== 'boolean') { u.showCommissionPage = false; changed = true; } });
  if (changed) writeJson('users.json', users);
}
seedUsers();
ensureLoginCodes();

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 20 * 1024 * 1024, files: 8 } });
const onlineUsers = new Map();

function authRequired(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = readJson('users.json').find(u => u.id === payload.userId);
    if (!user || user.accountStatus === 'deleted') return res.status(401).json({ error: 'User not found' });
    if (user.accountStatus === 'suspended' || user.accountStatus === 'closed') return res.status(403).json({ error: `Account ${user.accountStatus}` });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
function roleRequired(...roles) {
  return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Forbidden' });
}

function sanitizeTripForRole(trip, role) {
  if (['driver','contractor_driver'].includes(role)) {
    const { priceBreakdown, payer, dateOfBirth, mrn, ...rest } = trip;
    return rest;
  }
  return trip;
}
function latestAttendanceForUser(userId) { return readJson('attendance.json').find(x => x.userId === userId); }
function isClockedIn(userId) {
  const latest = latestAttendanceForUser(userId);
  if (!latest) return false;
  return ['clock_in','lunch_in'].includes(latest.type);
}
function clockedInUsers() {
  const users = readJson('users.json');
  const attendance = readJson('attendance.json');
  const latestByUser = {};
  for (const item of attendance) if (!latestByUser[item.userId]) latestByUser[item.userId] = item;
  return users.filter(u => u.accountStatus === 'active' && ['clock_in','lunch_in'].includes(latestByUser[u.id]?.type));
}
function nextTripNumber() {
  const trips = readJson('trips.json');
  const max = trips.reduce((m, t) => Math.max(m, Number(String(t.tripNumber || '').split('-').pop()) || 0), 0);
  return `TRIP-${String(max + 1).padStart(6, '0')}`;
}
function calcMileagePrice(miles, settings) {
  let remaining = Number(miles || 0); let total = 0; let prev = 0;
  for (const tier of settings.mileageTiers || []) {
    const amount = Math.max(Math.min(remaining, tier.upTo - prev), 0);
    total += amount * Number(tier.rate || 0);
    remaining -= amount; prev = tier.upTo;
    if (remaining <= 0) break;
  }
  return total;
}
function calculateTripPrice(payload) {
  const settings = readJson('priceSettings.json');
  const serviceKey = String(payload.service || '').toLowerCase().replace(/ /g, '_');
  const base = Number(settings.services[serviceKey] || 0);
  const mileageFee = calcMileagePrice(payload.mileage, settings);
  const weightFee = Number(payload.weight || 0) >= Number(settings.bariatricThreshold || 250) ? Number(settings.weightSurcharge || 0) : 0;
  const oxygenLiters = payload.oxygen === true || payload.oxygen === 'Yes' ? Number(payload.oxygenLiters || 0) : 0;
  const oxygenFee = oxygenLiters > 0 ? Number(settings.oxygen.base || 0) + oxygenLiters * Number(settings.oxygen.perLiter || 0) : 0;
  const stopFee = (payload.additionalStops || []).length * Number(settings.extraStop || 0);
  return { base, mileageFee, weightFee, oxygenFee, stopFee, total: base + mileageFee + weightFee + oxygenFee + stopFee };
}
function parseMaybeJson(value, fallback = []) { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
function createNotification(userIds, title, body, type='info', extra={}) {
  const all = readJson('notifications.json');
  const items = [...new Set(userIds)].filter(Boolean).map(userId => ({ id: uuidv4(), userId, title, body, type, createdAt: nowIso(), read: false, ...extra }));
  writeJson('notifications.json', [...items, ...all].slice(0, 5000));
  items.forEach(n => io.to(n.userId).emit('notification', n));
}
function requiredTripFields(body) {
  const missing = [];
  ['pickupDate','pickupTime','patientName','pickupLocation','service','weight','dropoffLocation','caregiverOnBoard','note','dateOfBirth','payer'].forEach(k => { if (body[k] === undefined || body[k] === '') missing.push(k); });
  if ((body.oxygen === true || body.oxygen === 'Yes') && !body.oxygenLiters) missing.push('oxygenLiters');
  if ((body.caregiverOnBoard === true || body.caregiverOnBoard === 'Yes') && (body.caregiverCount === undefined || body.caregiverCount === '')) missing.push('caregiverCount');
  return missing;
}
async function uploadFileToGoogleDrive(localPath, originalName, mimeType) {
  if (!google || !process.env.GOOGLE_DRIVE_CLIENT_EMAIL || !process.env.GOOGLE_DRIVE_PRIVATE_KEY || !process.env.GOOGLE_DRIVE_FOLDER_ID) return null;
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_DRIVE_CLIENT_EMAIL,
    key: process.env.GOOGLE_DRIVE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/drive.file']
  });
  const drive = google.drive({ version: 'v3', auth });
  const response = await drive.files.create({
    requestBody: { name: `${Date.now()}-${originalName}`, parents: [process.env.GOOGLE_DRIVE_FOLDER_ID] },
    media: { mimeType, body: fs.createReadStream(localPath) },
    fields: 'id,webViewLink,webContentLink'
  });
  return { id: response.data.id, viewLink: response.data.webViewLink || '', downloadLink: response.data.webContentLink || '' };
}
async function storeUploaded(file) {
  const localUrl = `/uploads/${path.basename(file.path)}`;
  let drive = null;
  try { drive = await uploadFileToGoogleDrive(file.path, file.originalname, file.mimetype); } catch (e) { console.error(e.message); }
  return { id: uuidv4(), originalName: file.originalname, mimeType: file.mimetype, localUrl, storage: drive ? 'google_drive' : 'local', googleDrive: drive, uploadedAt: nowIso() };
}
async function tryCreateSheetInvoiceBatch() {
  const runs = readJson('invoiceRuns.json');
  const now = new Date();
  const epochSunday = new Date('2026-01-04T23:00:00');
  const diffWeeks = Math.floor((now - epochSunday) / (7 * 24 * 3600 * 1000));
  const isBiweekly = diffWeeks >= 0 && diffWeeks % 2 === 0;
  if (!(now.getDay() === 0 && now.getHours() === 23 && isBiweekly)) return;
  const runKey = `${now.getUTCFullYear()}-${now.getUTCMonth()+1}-${now.getUTCDate()}-${now.getUTCHours()}`;
  if (runs.find(r => r.runKey === runKey)) return;
  const trips = readJson('trips.json').filter(t => t.status === 'completed');
  const batch = trips.map(t => [t.tripNumber, t.pickupDate, t.patientName, t.payer, Number(t.mileage || 0), Number(t.priceBreakdown?.total || 0)]);
  const result = { id: uuidv4(), runKey, createdAt: nowIso(), tripCount: batch.length, status: 'local_only' };
  runs.unshift(result); writeJson('invoiceRuns.json', runs.slice(0, 200));
  if (!google || !process.env.GOOGLE_SHEETS_CLIENT_EMAIL || !process.env.GOOGLE_SHEETS_PRIVATE_KEY || !process.env.GOOGLE_SHEETS_SPREADSHEET_ID) return;
  try {
    const auth = new google.auth.JWT({ email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL, key: process.env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, '\n'), scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const sheets = google.sheets({ version: 'v4', auth });
    const title = `Invoices ${now.toISOString().slice(0,10)}`;
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title } } }] } }).catch(()=>{});
    await sheets.spreadsheets.values.update({ spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID, range: `${title}!A1`, valueInputOption: 'RAW', requestBody: { values: [['Trip ID','Date','Patient','Payer','Mileage','Gross'], ...batch] } });
    result.status = 'sheet_written'; writeJson('invoiceRuns.json', runs);
  } catch (e) { console.error('Invoice sheet write failed', e.message); }
}
setInterval(tryCreateSheetInvoiceBatch, 60000);

app.post('/api/auth/login', (req, res) => {
  const passcode = normalizePasscode(req.body.passcode || req.body.pin || '');
  if (!passcode) return res.status(400).json({ error: 'Passcode required' });
  const users = readJson('users.json');
  const user = users.find(u => bcrypt.compareSync(passcode, u.loginCodeHash || '$2a$10$invalidinvalidinvalidinva'));
  if (!user) return res.status(401).json({ error: 'Invalid passcode' });
  if (['suspended','closed','deleted'].includes(user.accountStatus)) return res.status(403).json({ error: `Account ${user.accountStatus}` });
  const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user: maskUser(user) });
});
app.get('/api/me', authRequired, (req, res) => res.json(maskUser(req.user)));
app.post('/api/me/complete-profile', authRequired, upload.single('identityFile'), async (req, res) => {
  const users = readJson('users.json');
  const idx = users.findIndex(u => u.id === req.user.id);
  const fileMeta = req.file ? await storeUploaded(req.file) : users[idx].identityFile;
  const updated = { ...users[idx], phone: req.body.phone, dateOfBirth: req.body.dateOfBirth, certificate: req.body.certificate || '', address: req.body.address, identityFile: fileMeta, mustCompleteProfile: false, updatedAt: nowIso() };
  users[idx] = updated; writeJson('users.json', users);
  res.json(maskUser(updated));
});

app.get('/api/users', authRequired, roleRequired('admin','manager','dispatcher'), (req, res) => res.json(readJson('users.json').map(maskUser)));
app.post('/api/users', authRequired, roleRequired('admin'), (req, res) => {
  const users = readJson('users.json');
  const email = normalizeEmail(req.body.email || `${String(req.body.name || 'user').toLowerCase().replace(/[^a-z0-9]+/g,'.')}.${Date.now()}@local.trinsit`);
  if (users.some(u => normalizeEmail(u.email) === email)) return res.status(400).json({ error: 'Email already exists' });
  const loginCode = normalizePasscode(req.body.loginCode || req.body.pin || `${Math.floor(100000 + Math.random() * 900000)}!`);
  if (!isLoginCodeUnique(users, loginCode)) return res.status(400).json({ error: 'Login code already exists' });
  const user = {
    id: uuidv4(), name: req.body.name, email, role: req.body.role, phone: '', dateOfBirth:'', certificate:'', address:'', identityFile:null, showCommissionPage: false,
    active: true, accountStatus: 'active', mustCompleteProfile: true, passwordHash: bcrypt.hashSync('legacy-password', 10), pinHash: bcrypt.hashSync(loginCode.slice(0,6), 10), loginCodeHash: bcrypt.hashSync(loginCode, 10), createdAt: nowIso(), updatedAt: nowIso()
  };
  users.unshift(user); writeJson('users.json', users); res.status(201).json({ ...maskUser(user), plainLoginCode: loginCode });
});
app.put('/api/users/:id', authRequired, roleRequired('admin'), (req, res) => {
  const users = readJson('users.json');
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  const next = { ...users[idx], ...req.body, updatedAt: nowIso() };
  if (req.body.resetPin || req.body.resetLoginCode) {
    const newCode = normalizePasscode(req.body.resetLoginCode || req.body.resetPin);
    if (!isLoginCodeUnique(users, newCode, req.params.id)) return res.status(400).json({ error: 'Login code already exists' });
    next.pinHash = bcrypt.hashSync(newCode.slice(0,6), 10);
    next.loginCodeHash = bcrypt.hashSync(newCode, 10);
    next.lastResetPin = newCode;
  }
  if (typeof req.body.showCommissionPage === 'boolean') next.showCommissionPage = req.body.showCommissionPage;
  if (req.body.accountStatus && ['active','suspended','closed','deleted'].includes(req.body.accountStatus)) next.accountStatus = req.body.accountStatus;
  users[idx] = next; writeJson('users.json', users); res.json(maskUser(next));
});
app.delete('/api/users/:id', authRequired, roleRequired('admin'), (req, res) => {
  const users = readJson('users.json');
  const target = users.find(u => u.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const next = users.filter(u => u.id !== req.params.id);
  writeJson('users.json', next);
  const gps = readJson('gps.json');
  if (gps[target.id]) { delete gps[target.id]; writeJson('gps.json', gps); io.emit('gps:clear', { userId: target.id }); }
  res.json({ ok: true });
});

app.get('/api/payers', authRequired, (req, res) => res.json(readJson('payers.json')));
app.post('/api/payers', authRequired, roleRequired('admin','manager'), (req, res) => {
  const payers = readJson('payers.json');
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Payer required' });
  if (!payers.includes(name)) payers.push(name);
  writeJson('payers.json', payers);
  res.status(201).json(payers);
});


app.delete('/api/payers/:name', authRequired, roleRequired('admin','manager'), (req, res) => {
  const payers = readJson('payers.json');
  const target = decodeURIComponent(String(req.params.name || '')).trim().toLowerCase();
  const next = payers.filter(p => String(p || '').trim().toLowerCase() !== target);
  writeJson('payers.json', next);
  res.json(next);
});

app.get('/api/price-settings', authRequired, (req, res) => res.json(readJson('priceSettings.json')));
app.put('/api/price-settings', authRequired, roleRequired('admin','manager'), (req, res) => { writeJson('priceSettings.json', req.body); res.json(req.body); });
app.post('/api/pricing/calculate', authRequired, (req, res) => res.json(calculateTripPrice(req.body)));
app.get('/api/feature-settings', authRequired, roleRequired('admin'), (req, res) => res.json(readJson('featureSettings.json')));
app.put('/api/feature-settings', authRequired, roleRequired('admin'), (req, res) => { const next = { ...readJson('featureSettings.json'), ...req.body, updatedAt: nowIso() }; writeJson('featureSettings.json', next); res.json(next); });
app.get('/api/geo/suggest', authRequired, async (req, res) => {
  try {
    res.json(await suggestAddresses(req.query.q || ''));
  } catch (e) { res.json([]); }
});
app.get('/api/geo/mileage', authRequired, async (req, res) => {
  try {
    const out = await routeMileage(req.query.from || '', req.query.to || '');
    res.json({ miles: Number((out.miles || 0).toFixed(1)), from: out.from?.display_name || '', to: out.to?.display_name || '' });
  } catch (e) { res.json({ miles: 0 }); }
});

app.get('/api/trips', authRequired, (req, res) => {
  const trips = readJson('trips.json');
  const visible = ['driver','contractor_driver'].includes(req.user.role) ? trips.filter(t => (t.assignedDriverIds || []).includes(req.user.id)) : trips;
  res.json(visible.map(t => sanitizeTripForRole(t, req.user.role)));
});
app.post('/api/trips', authRequired, roleRequired('admin','manager','dispatcher'), async (req, res) => {
  const missing = requiredTripFields(req.body);
  if (missing.length) return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  const trips = readJson('trips.json');
  const assignedDriverIds = Array.isArray(req.body.assignedDriverIds) ? req.body.assignedDriverIds.slice(0,2) : (req.body.assignedDriverId ? [req.body.assignedDriverId] : []);
  let autoMiles = Number(req.body.googleMileage || req.body.mileage || 0);
  if ((!autoMiles || Number.isNaN(autoMiles)) && req.body.pickupLocation && req.body.dropoffLocation) { try { autoMiles = Number((await routeMileage(req.body.pickupLocation, req.body.dropoffLocation)).miles.toFixed(1)); } catch {} }
  const trip = {
    id: uuidv4(), tripNumber: nextTripNumber(), pickupDate: req.body.pickupDate, pickupTime: req.body.pickupTime, patientName: req.body.patientName,
    pickupLocation: req.body.pickupLocation, roomNumber: req.body.roomNumber || '', service: req.body.service, weight: Number(req.body.weight || 0),
    dropoffLocation: req.body.dropoffLocation, additionalStops: req.body.additionalStops || [], oxygen: req.body.oxygen, oxygenLiters: Number(req.body.oxygenLiters || 0),
    caregiverOnBoard: req.body.caregiverOnBoard, caregiverCount: Number(req.body.caregiverCount || 0), note: req.body.note, dateOfBirth: req.body.dateOfBirth, mrn: req.body.mrn || '', payer: req.body.payer,
    mileage: autoMiles, googleMileage: autoMiles, assignedDriverIds, status: assignedDriverIds.length ? 'assigned' : 'open',
    tripLogs: [{ status: assignedDriverIds.length ? 'assigned' : 'open', by: req.user.name, at: nowIso() }], facesheetFiles: [], cancelledAt: null, createdBy: req.user.id, createdAt: nowIso(), updatedAt: nowIso(),
    priceBreakdown: calculateTripPrice(req.body), vehicleUnit: req.body.vehicleUnit || ''
  };
  trips.unshift(trip); writeJson('trips.json', trips);
  if (assignedDriverIds.length) createNotification(assignedDriverIds, 'Trip Assigned', `${trip.tripNumber} ${trip.patientName} ${trip.pickupDate} ${trip.pickupTime}`, 'trip', { tripId: trip.id });
  io.emit('trip:updated', trip); res.status(201).json(trip);
});
app.put('/api/trips/:id', authRequired, roleRequired('admin','manager','dispatcher','driver','contractor_driver'), async (req, res) => {
  const trips = readJson('trips.json');
  const idx = trips.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Trip not found' });
  const current = trips[idx];
  if (['driver','contractor_driver'].includes(req.user.role) && !(current.assignedDriverIds || []).includes(req.user.id)) return res.status(403).json({ error: 'Not assigned' });
  const next = { ...current, ...req.body, updatedAt: nowIso() };
  if ((req.body.pickupLocation || req.body.dropoffLocation) && (req.body.googleMileage === undefined && req.body.mileage === undefined)) { try { const miles = await routeMileage(next.pickupLocation, next.dropoffLocation); next.googleMileage = Number((miles.miles || 0).toFixed(1)); next.mileage = next.googleMileage; } catch {} }
  if (['driver','contractor_driver'].includes(req.user.role)) {
    if (!isClockedIn(req.user.id)) return res.status(400).json({ error: 'Clock in before trip work' });
    const validOrder = ['assigned','trip_in_progress','arrived_pickup','leaving_with_patient','completed'];
    const currentStatus = current.status === 'arrived' ? 'arrived_pickup' : current.status;
    const requestedStatus = req.body.status === 'arrived' ? 'arrived_pickup' : req.body.status;
    if (requestedStatus && validOrder.includes(requestedStatus)) {
      const ci = validOrder.indexOf(currentStatus), ni = validOrder.indexOf(requestedStatus);
      if (ni !== ci + 1) return res.status(400).json({ error: 'Trip statuses must be completed in order' });
      if (requestedStatus === 'leaving_with_patient' && !(current.facesheetFiles||[]).length) return res.status(400).json({ error: 'Upload the facesheet before leaving with patient' });
      req.body.status = requestedStatus;
    }
  }
  if (req.body.cancelled === true || req.body.status === 'cancelled') { next.status = 'cancelled'; next.cancelledAt = nowIso(); }
  if (req.body.assignedDriverIds) next.assignedDriverIds = req.body.assignedDriverIds.slice(0,2);
  if (req.body.status && req.body.status !== current.status) next.tripLogs = [...(current.tripLogs || []), { status: req.body.status, by: req.user.name, at: nowIso() }];
  next.priceBreakdown = calculateTripPrice(next);
  trips[idx] = next; writeJson('trips.json', trips);
  if (JSON.stringify(current.assignedDriverIds || []) !== JSON.stringify(next.assignedDriverIds || [])) createNotification(next.assignedDriverIds || [], 'Trip Reassigned', `${next.tripNumber} reassigned`, 'trip', { tripId: next.id });
  io.emit('trip:updated', next); res.json(sanitizeTripForRole(next, req.user.role));
});
app.post('/api/trips/:id/facesheet', authRequired, roleRequired('driver','contractor_driver','admin','manager','dispatcher'), upload.single('file'), async (req, res) => {
  const trips = readJson('trips.json');
  const idx = trips.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Trip not found' });
  if (!req.file) return res.status(400).json({ error: 'File required' });
  const meta = await storeUploaded(req.file);
  trips[idx].facesheetFiles = [...(trips[idx].facesheetFiles || []), meta];
  trips[idx].tripLogs = [...(trips[idx].tripLogs || []), { status: 'facesheet_uploaded', by: req.user.name, at: nowIso() }];
  trips[idx].updatedAt = nowIso();
  writeJson('trips.json', trips);
  io.emit('trip:updated', trips[idx]);
  res.status(201).json(meta);
});

app.post('/api/attendance/clock', authRequired, async (req, res) => {
  const attendance = readJson('attendance.json');
  const item = {
    id: uuidv4(), userId: req.user.id, name: req.user.name, role: req.user.role, type: req.body.type, lat: req.body.lat, lng: req.body.lng, accuracy: req.body.accuracy,
    address: req.body.address || `${req.body.lat || ''}, ${req.body.lng || ''}`,
    payType: req.body.payType || (req.body.commissionPay ? 'commission' : 'hourly'),
    commissionPay: (req.body.payType || '').toLowerCase() === 'commission' || !!req.body.commissionPay,
    commissionTrips: Array.isArray(req.body.commissionTrips) ? req.body.commissionTrips : [], createdAt: req.body.createdAt || nowIso()
  };
  attendance.unshift(item); writeJson('attendance.json', attendance.slice(0, 5000));
  const gps = readJson('gps.json');
  if (item.type === 'clock_out') {
    delete gps[req.user.id]; writeJson('gps.json', gps); io.emit('gps:clear', { userId: req.user.id });
  } else if (item.type === 'clock_in' || item.type === 'lunch_in' || item.type === 'lunch_out') {
    gps[req.user.id] = { userId: req.user.id, name: req.user.name, role: req.user.role, lat: req.body.lat, lng: req.body.lng, accuracy: req.body.accuracy, updatedAt: nowIso() };
    writeJson('gps.json', gps); io.emit('gps:update', gps[req.user.id]);
  }
  res.status(201).json(item);
});
app.get('/api/attendance', authRequired, (req, res) => { const items = readJson('attendance.json'); if (['admin','manager','dispatcher'].includes(req.user.role)) return res.json(items); return res.json(items.filter(x => x.userId === req.user.id)); });
app.put('/api/attendance/:id', authRequired, roleRequired('admin'), (req, res) => {
  const attendance = readJson('attendance.json');
  const idx = attendance.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Attendance not found' });
  attendance[idx] = { ...attendance[idx], ...req.body, updatedAt: nowIso() };
  writeJson('attendance.json', attendance); res.json(attendance[idx]);
});
app.delete('/api/attendance/:id', authRequired, roleRequired('admin'), (req, res) => {
  const attendance = readJson('attendance.json');
  const next = attendance.filter(a => a.id !== req.params.id);
  writeJson('attendance.json', next);
  res.json({ ok: true });
});

app.post('/api/gps/update', authRequired, (req, res) => {
  if (!isClockedIn(req.user.id)) return res.status(400).json({ error: 'Clock in first' });
  const gps = readJson('gps.json');
  gps[req.user.id] = { userId: req.user.id, name: req.user.name, role: req.user.role, lat: req.body.lat, lng: req.body.lng, accuracy: req.body.accuracy, updatedAt: nowIso() };
  writeJson('gps.json', gps); io.emit('gps:update', gps[req.user.id]); res.json(gps[req.user.id]);
});
app.get('/api/gps', authRequired, roleRequired('admin','manager','dispatcher'), (req, res) => res.json(Object.values(readJson('gps.json'))));

app.get('/api/uploads/daily-download', authRequired, roleRequired('admin'), async (req, res) => {
  const targetDate = String(req.query.date || ymd(new Date()));
  const uploads = collectUploadsForDate(targetDate);
  res.setHeader('Cache-Control', 'no-store');
  if (!uploads.length) return res.status(404).json({ error: 'No uploaded documents found for that date' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="trinsit-uploads-${targetDate}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => {
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  });
  archive.pipe(res);
  archive.append(JSON.stringify({ date: targetDate, count: uploads.length, files: uploads.map(u => u.manifest) }, null, 2), { name: `manifest-${targetDate}.json` });
  uploads.forEach(item => archive.file(item.filePath, { name: item.archiveName }));
  await archive.finalize();
});

app.get('/api/dashboard/summary', authRequired, roleRequired('admin'), (req, res) => {
  const trips = readJson('trips.json').filter(t => t.status === 'completed');
  const expenses = readJson('expenses.json');
  const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
  const startOfWeek = new Date(); startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); startOfWeek.setHours(0,0,0,0);
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const sumTrips = list => list.reduce((s,t)=>s+Number(t.priceBreakdown?.total || 0),0);
  const sumExpenses = list => list.reduce((s,x)=>s+Number(x.amount || 0),0);
  const byDate = d => trips.filter(t => new Date(t.pickupDate || t.createdAt) >= d);
  const exByDate = d => expenses.filter(x => new Date(x.expenseDate || x.createdAt) >= d);
  const expensesByUser = Object.values(expenses.reduce((acc,e)=>{ const key=e.userName||'Unknown'; acc[key]=acc[key]||{userName:key,total:0}; acc[key].total+=Number(e.amount||0); return acc; }, {}));
  const vehicleMileage = Object.values(trips.reduce((acc,t)=>{ const key=t.vehicleUnit||'Unassigned Vehicle'; acc[key]=acc[key]||{vehicleUnit:key,mileage:0}; acc[key].mileage+=Number(t.googleMileage || t.mileage || 0); return acc; }, {}));
  res.json({
    gross: { daily: sumTrips(byDate(startOfDay)), weekly: sumTrips(byDate(startOfWeek)), monthly: sumTrips(byDate(startOfMonth)) },
    expenses: { daily: sumExpenses(exByDate(startOfDay)), weekly: sumExpenses(exByDate(startOfWeek)), monthly: sumExpenses(exByDate(startOfMonth)), byUser: expensesByUser },
    net: { daily: sumTrips(byDate(startOfDay))-sumExpenses(exByDate(startOfDay)), weekly: sumTrips(byDate(startOfWeek))-sumExpenses(exByDate(startOfWeek)), monthly: sumTrips(byDate(startOfMonth))-sumExpenses(exByDate(startOfMonth)) },
    vehicleMileage
  });
});

app.get('/api/expenses', authRequired, (req, res) => {
  const expenses = readJson('expenses.json');
  res.json(['driver','contractor_driver'].includes(req.user.role) ? expenses.filter(e => e.userId === req.user.id) : expenses);
});
app.post('/api/expenses', authRequired, upload.single('receipt'), async (req, res) => {
  const category = String(req.body.category || 'Other');
  if (category === 'Maintenance' && !req.body.note) return res.status(400).json({ error: 'Maintenance note required' });
  if (category === 'Other' && !req.body.otherText) return res.status(400).json({ error: 'Other text required' });
  const receipt = req.file ? await storeUploaded(req.file) : null;
  const item = { id: uuidv4(), userId: req.user.id, userName: req.user.name, category, otherText: req.body.otherText || '', note: req.body.note || '', expenseDate: req.body.expenseDate, amount: Number(req.body.amount || 0), receipt, createdAt: nowIso() };
  const expenses = readJson('expenses.json'); expenses.unshift(item); writeJson('expenses.json', expenses); res.status(201).json(item);
});
app.put('/api/expenses/:id', authRequired, roleRequired('admin'), (req, res) => {
  const expenses = readJson('expenses.json');
  const idx = expenses.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Expense not found' });
  expenses[idx] = { ...expenses[idx], ...req.body, amount: Number(req.body.amount ?? expenses[idx].amount), updatedAt: nowIso() };
  writeJson('expenses.json', expenses);
  res.json(expenses[idx]);
});
app.delete('/api/expenses/:id', authRequired, roleRequired('admin'), (req, res) => {
  const expenses = readJson('expenses.json');
  const next = expenses.filter(e => e.id !== req.params.id);
  writeJson('expenses.json', next);
  res.json({ ok: true });
});

app.get('/api/incidents', authRequired, (req, res) => res.json(readJson('incidents.json')));
app.post('/api/incidents', authRequired, upload.array('images', 4), async (req, res) => {
  const files = [];
  for (const file of req.files || []) files.push(await storeUploaded(file));
  const item = { id: uuidv4(), userId: req.user.id, userName: req.user.name, whatToReport: req.body.whatToReport, passengerNames: req.body.passengerNames, witnessNames: req.body.witnessNames, driverContact: req.body.driverContact, eventDate: req.body.eventDate, eventTime: req.body.eventTime, location: req.body.location, weather: req.body.weather, description: req.body.description, damagesInjuries: req.body.damagesInjuries, correctiveAction: req.body.correctiveAction || '', images: files, createdAt: nowIso() };
  const incidents = readJson('incidents.json'); incidents.unshift(item); writeJson('incidents.json', incidents); res.status(201).json(item);
});

app.get('/api/inspections', authRequired, (req, res) => res.json(readJson('inspections.json')));
app.post('/api/inspections', authRequired, upload.array('images', 6), async (req, res) => {
  const images = [];
  for (const file of req.files || []) images.push(await storeUploaded(file));
  const item = { id: uuidv4(), userId: req.user.id, userName: req.user.name, date: req.body.date, time: req.body.time, vehicleNumber: req.body.vehicleNumber, odometerReading: req.body.odometerReading, brakes: req.body.brakes, tires: req.body.tires, steering: req.body.steering, lights: req.body.lights, fluidLevels: req.body.fluidLevels, wheelchairLift: req.body.wheelchairLift, rampCondition: req.body.rampCondition, liftInterlock: req.body.liftInterlock, securementSystem: req.body.securementSystem, seatBelts: req.body.seatBelts, seatCondition: req.body.seatCondition, mirrors: req.body.mirrors, wipers: req.body.wipers, horn: req.body.horn, tieDowns: req.body.tieDowns, interiorCleanliness: req.body.interiorCleanliness, exteriorSafety: req.body.exteriorSafety, defects: req.body.defects, correctiveActionTaken: req.body.correctiveActionTaken, images, createdAt: nowIso() };
  const all = readJson('inspections.json'); all.unshift(item); writeJson('inspections.json', all); res.status(201).json(item);
});

app.get('/api/equipment', authRequired, (req, res) => res.json(readJson('equipment.json')));
app.post('/api/equipment', authRequired, roleRequired('admin'), (req, res) => { const all = readJson('equipment.json'); const item = { id: uuidv4(), ...req.body, createdAt: nowIso(), checkEntries: [] }; all.unshift(item); writeJson('equipment.json', all); res.status(201).json(item); });
app.post('/api/equipment/:id/check', authRequired, roleRequired('driver','contractor_driver','admin','manager','dispatcher'), upload.array('images', 4), async (req, res) => {
  const all = readJson('equipment.json'); const idx = all.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Equipment not found' });
  const images = []; for (const file of req.files || []) images.push(await storeUploaded(file));
  const entry = { id: uuidv4(), userId: req.user.id, userName: req.user.name, status: req.body.status || 'OK', note: req.body.note || '', images, createdAt: nowIso() };
  all[idx].checkEntries = [entry, ...(all[idx].checkEntries || [])];
  writeJson('equipment.json', all); res.status(201).json(entry);
});

app.get('/api/chat/users', authRequired, (req, res) => {
  res.json(clockedInUsers().map(maskUser));
});
app.get('/api/chat/directory', authRequired, (req, res) => {
  const users = readJson('users.json').filter(u => u.accountStatus === 'active').map(u => ({...maskUser(u), online: onlineUsers.has(u.id)}));
  res.json(users);
});
app.get('/api/chat/channels', authRequired, (req, res) => {
  const channels = readJson('channels.json').filter(c => (c.memberIds || []).includes(req.user.id) || c.createdBy === req.user.id);
  res.json(channels);
});
app.post('/api/chat/channels', authRequired, (req, res) => {
  const name = String(req.body.name || '').trim();
  const memberIds = Array.from(new Set([req.user.id, ...((Array.isArray(req.body.memberIds) ? req.body.memberIds : []))])).filter(Boolean);
  if (!name) return res.status(400).json({ error: 'Channel name required' });
  if (memberIds.length < 2) return res.status(400).json({ error: 'Choose at least one teammate' });
  const channels = readJson('channels.json');
  const item = { id: uuidv4(), name, memberIds, createdBy: req.user.id, createdAt: nowIso() };
  channels.unshift(item); writeJson('channels.json', channels.slice(0, 500));
  memberIds.forEach(id => io.to(id).emit('channel:new', item));
  createNotification(memberIds.filter(id => id !== req.user.id), 'New Group Channel', `${req.user.name} added you to ${name}`, 'message', { channelId: item.id });
  res.status(201).json(item);
});

app.get('/api/messages', authRequired, (req, res) => {
  const all = readJson('messages.json');
  const visible = all.filter(m => {
    if (m.channelId) {
      const channel = readJson('channels.json').find(c => c.id === m.channelId);
      return !!channel && (channel.memberIds || []).includes(req.user.id);
    }
    return !m.recipientIds?.length || m.recipientIds.includes(req.user.id) || m.userId === req.user.id;
  });
  res.json(visible.slice(0, 1000));
});
app.post('/api/messages', authRequired, (req, res) => {
  const recipientIds = Array.isArray(req.body.recipientIds) ? req.body.recipientIds : [];
  const channelId = req.body.channelId || '';
  if (!String(req.body.text || '').trim()) return res.status(400).json({ error: 'Message required' });
  let targets = [];
  if (channelId) {
    const channel = readJson('channels.json').find(c => c.id === channelId);
    if (!channel || !(channel.memberIds || []).includes(req.user.id)) return res.status(403).json({ error: 'No access to channel' });
    targets = channel.memberIds || [];
  } else {
    targets = recipientIds.length ? Array.from(new Set([...recipientIds, req.user.id])) : readJson('users.json').filter(u => u.accountStatus === 'active').map(u => u.id);
  }
  const item = { id: uuidv4(), userId: req.user.id, userName: req.user.name, role: req.user.role, text: req.body.text, recipientIds, channelId, createdAt: nowIso() };
  const all = readJson('messages.json'); all.unshift(item); writeJson('messages.json', all.slice(0, 3000));
  targets.forEach(id => io.to(id).emit('message:new', item));
  createNotification(targets.filter(id => id !== req.user.id), 'New Message', `${req.user.name}: ${String(req.body.text).slice(0,80)}`, 'message', { channelId, fromUserId: req.user.id });
  res.status(201).json(item);
});

function upcomingAppointmentReminders() {
  const trips = readJson('trips.json');
  const now = new Date(); let changed = false;
  trips.forEach(t => {
    if (['completed','cancelled'].includes(t.status) || t.remindedAt) return;
    const at = new Date(`${t.pickupDate}T${t.pickupTime || '00:00'}:00`);
    const diff = at - now;
    if (diff <= 60 * 60 * 1000 && diff >= 0) {
      createNotification([...(t.assignedDriverIds || []), ...readJson('users.json').filter(u => ['admin','dispatcher'].includes(u.role)).map(u => u.id)], 'Appointment Reminder', `${t.tripNumber} pickup in less than 1 hour`, 'appointment', { tripId: t.id });
      t.remindedAt = nowIso(); changed = true;
    }
  });
  if (changed) writeJson('trips.json', trips);
}
setInterval(upcomingAppointmentReminders, 60000);

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('auth')); const payload = jwt.verify(token, JWT_SECRET);
    const user = readJson('users.json').find(u => u.id === payload.userId); if (!user) return next(new Error('auth'));
    socket.user = user; next();
  } catch { next(new Error('auth')); }
});
io.on('connection', socket => {
  onlineUsers.set(socket.user.id, socket.id); socket.join(socket.user.id); io.emit('presence:update', Array.from(onlineUsers.keys()));
  socket.on('disconnect', () => { onlineUsers.delete(socket.user.id); io.emit('presence:update', Array.from(onlineUsers.keys())); });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
server.listen(PORT, '0.0.0.0', () => console.log(`TRINSIT app running on port ${PORT}`));
app.post('/api/trips/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const trips = JSON.parse(fs.readFileSync('data/trips.json', 'utf8'));

    const trip = trips.find(t => t.id === id);
    if (!trip) return res.status(404).json({ error: 'Trip not found' });

    // Update status
    trip.status = status;

    // Add log
    if (!trip.tripLogs) trip.tripLogs = [];
    trip.tripLogs.push({
      status,
      user: 'Driver',
      time: new Date().toISOString()
    });

    fs.writeFileSync('data/trips.json', JSON.stringify(trips, null, 2));

    res.json({ success: true, trip });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/trips/:id/facesheet', (req, res) => {
  const { id } = req.params;

  try {
    const trips = JSON.parse(fs.readFileSync('data/trips.json', 'utf8'));

    const trip = trips.find(t => t.id === id);
    if (!trip) return res.status(404).json({ error: 'Trip not found' });

    if (!trip.facesheetFiles) trip.facesheetFiles = [];

    trip.facesheetFiles.push({
      name: 'facesheet',
      time: new Date().toISOString()
    });

    if (!trip.tripLogs) trip.tripLogs = [];
    trip.tripLogs.push({
      status: 'facesheet_uploaded',
      user: 'Driver',
      time: new Date().toISOString()
    });

    fs.writeFileSync('data/trips.json', JSON.stringify(trips, null, 2));

    res.json({ success: true, trip });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
