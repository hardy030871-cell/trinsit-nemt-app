const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const multer = require('multer');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const PUBLIC_DIR = path.join(ROOT, 'public');

for (const dir of [DATA_DIR, UPLOADS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const FILES = {
  users: path.join(DATA_DIR, 'users.json'),
  trips: path.join(DATA_DIR, 'trips.json'),
  attendance: path.join(DATA_DIR, 'attendance.json'),
  expenses: path.join(DATA_DIR, 'expenses.json'),
  equipment: path.join(DATA_DIR, 'equipment.json'),
  incidents: path.join(DATA_DIR, 'incidents.json'),
  inspections: path.join(DATA_DIR, 'inspections.json'),
  chat: path.join(DATA_DIR, 'chat.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  live: path.join(DATA_DIR, 'liveLocations.json')
};

const DEFAULT_USERS = [
  { id: 'u-admin', name: 'TRINSIT Admin', role: 'admin', pin: '001900!', active: true, contractorPermission: true, phone: '', address: '', dob: '', status: 'available' },
  { id: 'u-dispatch', name: 'Dispatcher One', role: 'dispatcher', pin: '222222!', active: true, contractorPermission: false, phone: '', address: '', dob: '', status: 'available' },
  { id: 'u-manager', name: 'Manager One', role: 'manager', pin: '555555!', active: true, contractorPermission: false, phone: '', address: '', dob: '', status: 'available' },
  { id: 'u-driver', name: 'Driver One', role: 'driver', pin: '333333!', active: true, contractorPermission: false, phone: '', address: '', dob: '', status: 'off_duty' },
  { id: 'u-contractor', name: 'Contractor One', role: 'contractor_driver', pin: '444444!', active: true, contractorPermission: true, phone: '', address: '', dob: '', status: 'off_duty' }
];

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      writeJson(file, fallback);
      return fallback;
    }
    const raw = fs.readFileSync(file, 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function ensureArrayData(file, fallbackItems) {
  const data = readJson(file, fallbackItems);
  if (!Array.isArray(data) || data.length === 0) {
    writeJson(file, fallbackItems);
    return fallbackItems;
  }
  return data;
}
function normalizePin(pin) {
  return String(pin || '').trim();
}
function repairDefaultUsers() {
  const now = new Date().toISOString();
  const loadedUsers = readJson(FILES.users, []);
  const users = Array.isArray(loadedUsers) ? loadedUsers : [];
  let changed = false;
  for (const defaultUser of DEFAULT_USERS) {
    const idx = users.findIndex(user => user.id === defaultUser.id);
    if (idx < 0) {
      users.push({ ...defaultUser, createdAt: now });
      changed = true;
      continue;
    }
    const existing = users[idx];
    const repaired = {
      ...defaultUser,
      ...existing,
      pin: normalizePin(existing.pin || defaultUser.pin),
      role: existing.role || defaultUser.role,
      active: existing.active !== false,
      contractorPermission: existing.contractorPermission ?? defaultUser.contractorPermission,
      createdAt: existing.createdAt || now
    };
    if (JSON.stringify(existing) !== JSON.stringify(repaired)) {
      users[idx] = repaired;
      changed = true;
    }
  }
  if (changed) writeJson(FILES.users, users);
}

function seed() {
  const defaultTrips = [
    {
      id: 'TRIP-000001',
      pickupTime: new Date(Date.now() + 3600e3).toISOString(),
      patientName: 'John Carter',
      pickupLocation: '123 Main St, Ocala, FL',
      dropoffLocation: 'Munroe Regional Medical Center, Ocala, FL',
      service: 'Wheelchair',
      weight: '185',
      oxygen: 'No',
      otherStop: '',
      payer: 'Private Pay',
      mileage: '8.2',
      status: 'assigned',
      driverIds: ['u-driver'],
      tripLogs: [{ status: 'assigned', at: new Date().toISOString(), by: 'u-dispatch' }],
      facesheetFiles: [],
      createdAt: new Date().toISOString()
    }
  ];
  const defaultEquipment = [
    { id: uuidv4(), name: 'Wheelchair', required: true },
    { id: uuidv4(), name: 'Oxygen Tank', required: true },
    { id: uuidv4(), name: 'First Aid Kit', required: true },
    { id: uuidv4(), name: 'Stair Chair', required: false }
  ];
  const defaultSettings = {
    payers: ['Private Pay', 'Medicaid', 'VA', 'Facility Contract'],
    featureFlags: {
      chat: true,
      liveMap: true,
      expenses: true,
      equipment: true,
      driverTwoAssignment: true,
      commissionMode: true
    },
    chatVisibleUserIds: [],
    customTripFields: ['Date of Birth','MRN'],
    inspectionExtraFields: [],
    incidentExtraFields: []
  };
  ensureArrayData(FILES.users, DEFAULT_USERS.map(user => ({ ...user, createdAt: new Date().toISOString() })));
  repairDefaultUsers();
  ensureArrayData(FILES.trips, defaultTrips);
  ensureArrayData(FILES.attendance, []);
  ensureArrayData(FILES.expenses, []);
  ensureArrayData(FILES.equipment, defaultEquipment);
  ensureArrayData(FILES.incidents, []);
  ensureArrayData(FILES.inspections, []);
  const chatSeed = readJson(FILES.chat, { channels: [], direct: [] });
  if (!chatSeed || typeof chatSeed !== 'object' || !Array.isArray(chatSeed.direct) || !Array.isArray(chatSeed.channels)) writeJson(FILES.chat, { channels: [], direct: [] });
  const settingsSeed = readJson(FILES.settings, defaultSettings);
  if (!settingsSeed || typeof settingsSeed !== 'object' || !Array.isArray(settingsSeed.payers)) {
    writeJson(FILES.settings, defaultSettings);
  } else {
    const mergedSettings = {
      ...defaultSettings,
      ...settingsSeed,
      featureFlags: { ...defaultSettings.featureFlags, ...(settingsSeed.featureFlags || {}) },
      payers: Array.isArray(settingsSeed.payers) ? settingsSeed.payers : defaultSettings.payers,
      chatVisibleUserIds: Array.isArray(settingsSeed.chatVisibleUserIds) ? settingsSeed.chatVisibleUserIds : [],
      customTripFields: Array.isArray(settingsSeed.customTripFields) ? settingsSeed.customTripFields : defaultSettings.customTripFields,
      inspectionExtraFields: Array.isArray(settingsSeed.inspectionExtraFields) ? settingsSeed.inspectionExtraFields : [],
      incidentExtraFields: Array.isArray(settingsSeed.incidentExtraFields) ? settingsSeed.incidentExtraFields : []
    };
    writeJson(FILES.settings, mergedSettings);
  }
  const liveSeed = readJson(FILES.live, {});
  if (!liveSeed || typeof liveSeed !== 'object' || Array.isArray(liveSeed)) writeJson(FILES.live, {});
}
seed();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g,'_')}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(['image/jpeg','image/png','image/webp','image/gif','application/pdf']);
    if (allowed.has(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported file type'));
  }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(PUBLIC_DIR));

function resolveTokenSecret() {
  if (process.env.TOKEN_SECRET) return process.env.TOKEN_SECRET;
  const secretFile = path.join(DATA_DIR, '.token-secret');
  try {
    if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim();
  } catch {}
  const secret = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(secretFile, secret, { mode: 0o600 }); } catch {}
  return secret;
}

const TOKEN_SECRET = resolveTokenSecret();
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function signValue(value) {
  return crypto.createHmac('sha256', TOKEN_SECRET).update(value).digest('base64url');
}

function makeToken(user) {
  const payload = { uid: user.id, iat: Date.now(), exp: Date.now() + TOKEN_TTL_MS };
  const payloadRaw = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = signValue(payloadRaw);
  return `${payloadRaw}.${sig}`;
}

function parseToken(token) {
  try {
    const [payloadRaw, sig] = String(token || '').split('.');
    if (!payloadRaw || !sig) return null;
    const expected = signValue(payloadRaw);
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const payload = JSON.parse(Buffer.from(payloadRaw, 'base64url').toString('utf8'));
    if (!payload || typeof payload.uid !== 'string') return null;
    if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
    return payload.uid;
  } catch {
    return null;
  }
}
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const userId = token ? parseToken(token) : null;
  const users = readJson(FILES.users, []);
  const user = users.find(u => u.id === userId && u.active);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

function nextTripId(trips) {
  const max = trips.reduce((m, t) => Math.max(m, Number((t.id || '').split('-')[1] || 0)), 0);
  return `TRIP-${String(max + 1).padStart(6, '0')}`;
}
function sanitizeUser(user) {
  const { pin, ...rest } = user;
  return rest;
}
function currentAttendance(userId) {
  const rows = readJson(FILES.attendance, []);
  return [...rows].reverse().find(a => a.userId === userId && !a.clockOutAt);
}
function pruneLiveLocations(live) {
  const cutoff = Date.now() - 5 * 60 * 1000;
  return Object.fromEntries(Object.entries(live).filter(([, value]) => {
    const seenAt = Date.parse(value.at || '');
    return Number.isFinite(seenAt) && seenAt >= cutoff;
  }));
}

function parseJsonField(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}


function listUploadedFilesForDay(day) {
  const target = day || new Date().toISOString().slice(0,10);
  const files = [];
  const pushIf = (kind, obj, filePath) => {
    if (!filePath) return;
    const at = obj.at || obj.createdAt || obj.date || '';
    if (String(at).slice(0,10) === target) files.push({ kind, file: filePath, at, sourceId: obj.id || '' });
  };
  for (const expense of readJson(FILES.expenses, [])) pushIf('expense_receipt', expense, expense.receipt);
  for (const trip of readJson(FILES.trips, [])) {
    for (const f of (trip.facesheetFiles || [])) pushIf('trip_facesheet', f, f.file);
  }
  for (const item of readJson(FILES.incidents, [])) {
    for (const f of (item.files || [])) pushIf('incident_file', f, f.file);
  }
  for (const item of readJson(FILES.inspections, [])) {
    for (const f of (item.files || [])) pushIf('inspection_file', f, f.file);
  }
  return files;
}

io.use((socket, next) => {
  const userId = parseToken(socket.handshake?.auth?.token || '');
  if (!userId) return next(new Error('Unauthorized'));
  const users = readJson(FILES.users, []);
  const user = users.find(u => u.id === userId && u.active);
  if (!user) return next(new Error('Unauthorized'));
  socket.user = user;
  next();
});

io.on('connection', socket => {
  if (socket.user && socket.user.id) socket.join('user:' + socket.user.id);
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'TRINSIT Rebuild', timestamp: new Date().toISOString() });
});

app.post('/api/login', (req, res) => {
  try {
    const pin = normalizePin(req.body?.pin);
    if (!pin) return res.status(400).json({ error: 'PIN is required' });
    const users = ensureArrayData(FILES.users, DEFAULT_USERS.map(user => ({ ...user, createdAt: new Date().toISOString() })));
    const user = users.find(u => normalizePin(u.pin) === pin && u.active);
    if (!user) return res.status(401).json({ error: 'Invalid PIN' });
    const token = makeToken(user);
    res.json({ token, user: sanitizeUser(user) });
  } catch (error) {
    console.error('LOGIN ERROR', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/bootstrap', auth, (req, res) => {
  const users = readJson(FILES.users, []).map(sanitizeUser);
  const allTrips = readJson(FILES.trips, []);
  const trips = roleFilterTrips(req.user, allTrips);
  const attendance = readJson(FILES.attendance, []);
  const allExpenses = readJson(FILES.expenses, []);
  const expenses = ['admin','dispatcher','manager'].includes(req.user.role) ? allExpenses : allExpenses.filter(e => e.userId === req.user.id);
  const equipment = readJson(FILES.equipment, []);
  const settings = readJson(FILES.settings, {});
  const liveLocations = pruneLiveLocations(readJson(FILES.live, {}));
  const chatSeed = readJson(FILES.chat, { channels: [], direct: [] });
  const visibleDirect = (chatSeed.direct || []).filter(msg => msg.fromId === req.user.id || (msg.toIds || []).includes(req.user.id));
  const chat = { channels: Array.isArray(chatSeed.channels) ? chatSeed.channels : [], direct: visibleDirect };
  writeJson(FILES.live, liveLocations);
  res.json({ user: sanitizeUser(req.user), users, trips, attendance, expenses, equipment, settings, liveLocations, chat });
});

app.get('/api/users', auth, requireRole('admin','dispatcher','manager'), (_req, res) => {
  res.json(readJson(FILES.users, []).map(sanitizeUser));
});

app.post('/api/users', auth, requireRole('admin'), (req, res) => {
  const users = readJson(FILES.users, []);
  const { name, role, contractorPermission=false, phone='', address='', dob='' } = req.body;
  const pin = normalizePin(req.body.pin);
  if (!pin) return res.status(400).json({ error: 'PIN is required' });
  if (users.some(u => normalizePin(u.pin) === pin)) return res.status(400).json({ error: 'PIN already in use' });
  const user = { id: uuidv4(), name, role, pin, contractorPermission, phone, address, dob, active: true, status: 'off_duty', createdAt: new Date().toISOString() };
  users.push(user);
  writeJson(FILES.users, users);
  res.json(sanitizeUser(user));
});

app.put('/api/users/:id', auth, requireRole('admin'), (req, res) => {
  const users = readJson(FILES.users, []);
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'User not found' });
  const body = { ...req.body };
  if (body.pin) body.pin = normalizePin(body.pin);
  const next = { ...users[idx], ...body };
  if (body.pin && users.some(u => u.id !== req.params.id && normalizePin(u.pin) === body.pin)) return res.status(400).json({ error: 'PIN already in use' });
  users[idx] = next;
  writeJson(FILES.users, users);
  res.json(sanitizeUser(next));
});

app.delete('/api/users/:id', auth, requireRole('admin'), (req, res) => {
  const users = readJson(FILES.users, []);
  const target = users.find(u => u.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === 'u-admin' || target.role === 'admin') return res.status(400).json({ error: 'Main admin cannot be deleted' });
  const nextUsers = users.filter(u => u.id !== req.params.id);
  writeJson(FILES.users, nextUsers);
  res.json({ ok: true });
});

app.post('/api/users/:id/reset-pin', auth, requireRole('admin'), (req, res) => {
  const users = readJson(FILES.users, []);
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'User not found' });
  const pin = normalizePin(req.body.pin);
  if (!pin) return res.status(400).json({ error: 'PIN is required' });
  if (users.some(u => u.id !== req.params.id && normalizePin(u.pin) === pin)) return res.status(400).json({ error: 'PIN already in use' });
  users[idx].pin = pin;
  writeJson(FILES.users, users);
  res.json({ ok: true });
});

app.post('/api/attendance/clock-in', auth, (req, res) => {
  const rows = readJson(FILES.attendance, []);
  if (rows.some(r => r.userId === req.user.id && !r.clockOutAt)) return res.status(400).json({ error: 'Already clocked in' });
  const entry = {
    id: uuidv4(), userId: req.user.id, userName: req.user.name, type: req.body.type || 'Hourly',
    clockInAt: req.body.time || new Date().toISOString(), clockOutAt: '', breakStartAt: '', breakEndAt: '',
    locationIn: req.body.location || '', locationOut: '', status: 'clocked_in', manualOverride: false,
    commissionEntries: req.body.commissionEntries || []
  };
  rows.push(entry);
  writeJson(FILES.attendance, rows);
  const users = readJson(FILES.users, []);
  const idx = users.findIndex(u => u.id === req.user.id);
  if (idx >= 0) { users[idx].status = 'available'; writeJson(FILES.users, users); }
  res.json(entry);
});

app.post('/api/attendance/break-start', auth, (req, res) => {
  const rows = readJson(FILES.attendance, []);
  const row = [...rows].reverse().find(r => r.userId === req.user.id && !r.clockOutAt);
  if (!row) return res.status(400).json({ error: 'Not clocked in' });
  row.breakStartAt = req.body.time || new Date().toISOString();
  row.status = 'on_break';
  writeJson(FILES.attendance, rows);
  res.json(row);
});

app.post('/api/attendance/break-end', auth, (req, res) => {
  const rows = readJson(FILES.attendance, []);
  const row = [...rows].reverse().find(r => r.userId === req.user.id && !r.clockOutAt);
  if (!row) return res.status(400).json({ error: 'Not clocked in' });
  row.breakEndAt = req.body.time || new Date().toISOString();
  row.status = 'available';
  writeJson(FILES.attendance, rows);
  res.json(row);
});

app.post('/api/attendance/clock-out', auth, (req, res) => {
  const rows = readJson(FILES.attendance, []);
  const row = [...rows].reverse().find(r => r.userId === req.user.id && !r.clockOutAt);
  if (!row) return res.status(400).json({ error: 'Not clocked in' });
  row.clockOutAt = req.body.time || new Date().toISOString();
  row.locationOut = req.body.location || '';
  row.status = 'clocked_out';
  writeJson(FILES.attendance, rows);
  const users = readJson(FILES.users, []);
  const idx = users.findIndex(u => u.id === req.user.id);
  if (idx >= 0) { users[idx].status = 'off_duty'; writeJson(FILES.users, users); }
  const live = readJson(FILES.live, {});
  delete live[req.user.id];
  writeJson(FILES.live, live);
  res.json(row);
});

app.post('/api/attendance/admin-adjust', auth, requireRole('admin'), (req, res) => {
  const rows = readJson(FILES.attendance, []);
  const { userId, action, time, note } = req.body;
  let row = [...rows].reverse().find(r => r.userId === userId && !r.clockOutAt);
  if (action === 'clock_in' && !row) {
    const user = readJson(FILES.users, []).find(u => u.id === userId);
    row = { id: uuidv4(), userId, userName: user?.name || 'Unknown', type: 'Hourly', clockInAt: time, clockOutAt: '', breakStartAt: '', breakEndAt: '', locationIn: '', locationOut: '', status: 'clocked_in', manualOverride: true, overrideReason: note || '', commissionEntries: [] };
    rows.push(row);
  } else if (row && action === 'clock_out') {
    row.clockOutAt = time;
    row.manualOverride = true;
    row.overrideReason = note || '';
    row.status = 'clocked_out';
  }
  writeJson(FILES.attendance, rows);
  res.json({ ok: true, row });
});

app.get('/api/trips', auth, (req, res) => {
  const trips = readJson(FILES.trips, []);
  const visible = roleFilterTrips(req.user, trips);
  res.json(visible);
});

function getTripProgressState(trip) {
  const logs = trip.tripLogs || [];
  const has = (st) => trip.status === st || logs.some(l => l.status === st || l.action === st || l.type === st);
  const hasFacesheet = Array.isArray(trip.facesheetFiles) && trip.facesheetFiles.length > 0 || has('facesheet_uploaded');
  return {
    inProgressDone: has('trip_in_progress'),
    arrivedDone: has('arrived_pickup'),
    leavingDone: has('leaving_with_patient'),
    completedDone: has('completed'),
    hasFacesheet
  };
}

function roleFilterTrips(user, trips) {
  if (['admin','dispatcher','manager'].includes(user.role)) return trips;
  return trips.filter(t => (t.driverIds || []).includes(user.id));
}

app.post('/api/trips', auth, requireRole('admin','dispatcher','manager'), (req, res) => {
  const trips = readJson(FILES.trips, []);
  const body = req.body;
  const trip = {
    id: nextTripId(trips),
    pickupTime: body.pickupTime,
    patientName: body.patientName,
    pickupLocation: body.pickupLocation,
    dropoffLocation: body.dropoffLocation,
    service: body.service,
    weight: body.weight,
    roomNumber: body.roomNumber || '',
    oxygen: body.oxygen,
    oxygenLiters: body.oxygenLiters || '',
    caregiver: body.caregiver || '',
    hasStop: body.hasStop || '',
    caregiverCount: body.caregiverCount || '',
    otherStop: body.otherStop || '',
    payer: body.payer || '',
    notes: body.notes || '',
    mileage: body.mileage || '',
    customFields: body.customFields && typeof body.customFields === 'object' ? body.customFields : {},
    status: 'assigned',
    driverIds: Array.isArray(body.driverIds) ? [...new Set(body.driverIds)].slice(0,2) : [],
    tripLogs: [{ status: 'assigned', at: new Date().toISOString(), by: req.user.id }],
    facesheetFiles: [],
    checkpointEvidenceFiles: [],
    checkpointMeta: {},
    createdAt: new Date().toISOString()
  };
  trips.push(trip);
  writeJson(FILES.trips, trips);
  io.emit('trip:new', trip);
  res.json(trip);
});

app.put('/api/trips/:id', auth, requireRole('admin','dispatcher','manager'), (req, res) => {
  const trips = readJson(FILES.trips, []);
  const idx = trips.findIndex(t => t.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Trip not found' });
  trips[idx] = { ...trips[idx], ...req.body };
  writeJson(FILES.trips, trips);
  res.json(trips[idx]);
});


app.delete('/api/trips/:id', auth, requireRole('admin'), (req, res) => {
  const trips = readJson(FILES.trips, []);
  const trip = trips.find(t => t.id === req.params.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  if (trip.status !== 'cancelled') return res.status(400).json({ error: 'Only cancelled trips can be deleted' });
  writeJson(FILES.trips, trips.filter(t => t.id !== req.params.id));
  res.json({ ok: true });
});

app.post('/api/trips/assign', auth, requireRole('admin','dispatcher','manager'), (req, res) => {
  const { tripId, driverIds } = req.body;
  const trips = readJson(FILES.trips, []);
  const trip = trips.find(t => t.id === tripId);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  trip.driverIds = Array.isArray(driverIds) ? [...new Set(driverIds)].slice(0, 2) : [];
  trip.status = trip.status === 'cancelled' ? 'assigned' : trip.status;
  trip.tripLogs = trip.tripLogs || [];
  trip.tripLogs.push({ status: 'assigned', at: new Date().toISOString(), by: req.user.id, driverIds: trip.driverIds });
  writeJson(FILES.trips, trips);
  io.emit('trip:assigned', trip);
  res.json(trip);
});

app.post('/api/trips/:id/status', auth, requireRole('driver','contractor_driver','admin','dispatcher','manager'), (req, res) => {
  const allowed = ['trip_in_progress','arrived_pickup','leaving_with_patient','completed','cancelled','on_hold'];
  const { status } = req.body;
  const meta = req.body && typeof req.body.meta === 'object' && req.body.meta ? req.body.meta : {};
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const trips = readJson(FILES.trips, []);
  const trip = trips.find(t => t.id === req.params.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  const isOps = ['admin','dispatcher','manager'].includes(req.user.role);
  if (!isOps && !(trip.driverIds || []).includes(req.user.id)) return res.status(403).json({ error: 'Trip not assigned to you' });
  if (!isOps && !currentAttendance(req.user.id)) return res.status(409).json({ error: 'Clock in before updating trip progress' });
  if (!isOps && ['cancelled','on_hold'].includes(status)) return res.status(403).json({ error: 'Only admin/manager/dispatch can cancel or hold trips' });

  const p = getTripProgressState(trip);
  if (status === 'arrived_pickup' && !p.inProgressDone) return res.status(409).json({ error: 'Trip must be in progress first' });
  if (status === 'leaving_with_patient' && !p.arrivedDone) return res.status(409).json({ error: 'Mark arrived before leaving with patient' });
  if (status === 'completed' && !p.leavingDone) return res.status(409).json({ error: 'Mark leaving with patient before completion' });

  trip.checkpointMeta = trip.checkpointMeta || {};

  trip.status = status;
  trip.tripLogs = trip.tripLogs || [];
  trip.tripLogs.push({ status, at: new Date().toISOString(), by: req.user.id, meta });
  writeJson(FILES.trips, trips);
  io.emit('trip:updated', trip);
  res.json({ trip });
});

app.post('/api/trips/:id/facesheet', auth, upload.single('file'), (req, res) => {
  const trips = readJson(FILES.trips, []);
  const trip = trips.find(t => t.id === req.params.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  const isOps = ['admin','dispatcher','manager'].includes(req.user.role);
  if (!isOps && !(trip.driverIds || []).includes(req.user.id)) return res.status(403).json({ error: 'Trip not assigned to you' });
  if (!req.file) return res.status(400).json({ error: 'Facesheet file is required' });
  trip.facesheetFiles = trip.facesheetFiles || [];
  trip.facesheetFiles.push({ id: uuidv4(), file: `/uploads/${req.file.filename}`, at: new Date().toISOString(), by: req.user.id });
  trip.tripLogs = trip.tripLogs || [];
  trip.tripLogs.push({ status: 'facesheet_uploaded', at: new Date().toISOString(), by: req.user.id });
  writeJson(FILES.trips, trips);
  io.emit('trip:updated', trip);
  res.json({ trip });
});

app.post('/api/trips/:id/evidence', auth, upload.single('file'), (req, res) => {
  const trips = readJson(FILES.trips, []);
  const trip = trips.find(t => t.id === req.params.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  const isOps = ['admin','dispatcher','manager'].includes(req.user.role);
  if (!isOps && !(trip.driverIds || []).includes(req.user.id)) return res.status(403).json({ error: 'Trip not assigned to you' });
  if (!req.file) return res.status(400).json({ error: 'Evidence file is required' });
  trip.checkpointEvidenceFiles = trip.checkpointEvidenceFiles || [];
  trip.checkpointEvidenceFiles.push({ id: uuidv4(), file: '/uploads/' + req.file.filename, at: new Date().toISOString(), by: req.user.id });
  trip.tripLogs = trip.tripLogs || [];
  trip.tripLogs.push({ status: 'checkpoint_evidence_uploaded', at: new Date().toISOString(), by: req.user.id });
  writeJson(FILES.trips, trips);
  io.emit('trip:updated', trip);
  res.json({ trip });
});

app.get('/api/expenses', auth, (req, res) => {
  const expenses = readJson(FILES.expenses, []);
  const visible = ['admin','dispatcher','manager'].includes(req.user.role) ? expenses : expenses.filter(e => e.userId === req.user.id);
  res.json(visible);
});

app.post('/api/expenses', auth, upload.single('receipt'), (req, res) => {
  const expenses = readJson(FILES.expenses, []);
  const item = { id: uuidv4(), userId: req.user.id, userName: req.user.name, category: req.body.category, amount: req.body.amount, note: req.body.note || '', date: req.body.date || new Date().toISOString().slice(0,10), receipt: req.file ? `/uploads/${req.file.filename}` : '' };
  expenses.push(item);
  writeJson(FILES.expenses, expenses);
  res.json(item);
});

app.put('/api/expenses/:id', auth, requireRole('admin'), (req, res) => {
  const expenses = readJson(FILES.expenses, []);
  const idx = expenses.findIndex(e => e.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Expense not found' });
  expenses[idx] = { ...expenses[idx], ...req.body };
  writeJson(FILES.expenses, expenses);
  res.json(expenses[idx]);
});

app.delete('/api/expenses/:id', auth, requireRole('admin'), (req, res) => {
  const expenses = readJson(FILES.expenses, []);
  writeJson(FILES.expenses, expenses.filter(e => e.id !== req.params.id));
  res.json({ ok: true });
});

app.post('/api/equipment', auth, requireRole('admin'), (req, res) => {
  const equipment = readJson(FILES.equipment, []);
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Equipment name is required' });
  if (equipment.some(item => item.name.toLowerCase() === name.toLowerCase())) return res.status(400).json({ error: 'Equipment already exists' });
  const item = { id: uuidv4(), name, required: Boolean(req.body.required) };
  equipment.push(item);
  writeJson(FILES.equipment, equipment);
  res.json(item);
});

app.put('/api/equipment/:id', auth, requireRole('admin'), (req, res) => {
  const equipment = readJson(FILES.equipment, []);
  const idx = equipment.findIndex(item => item.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Equipment not found' });
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Equipment name is required' });
  if (equipment.some(item => item.id !== req.params.id && item.name.toLowerCase() === name.toLowerCase())) return res.status(400).json({ error: 'Equipment already exists' });
  equipment[idx] = { ...equipment[idx], name, required: Boolean(req.body.required) };
  writeJson(FILES.equipment, equipment);
  res.json(equipment[idx]);
});

app.delete('/api/equipment/:id', auth, requireRole('admin'), (req, res) => {
  const equipment = readJson(FILES.equipment, []);
  writeJson(FILES.equipment, equipment.filter(item => item.id !== req.params.id));
  res.json({ ok: true });
});

app.post('/api/payers', auth, requireRole('admin','manager'), (req, res) => {
  const settings = readJson(FILES.settings, { payers: [], featureFlags: {} });
  const payer = String(req.body.payer || '').trim();
  if (!payer) return res.status(400).json({ error: 'Payer name is required' });
  settings.payers = settings.payers || [];
  if (settings.payers.some(item => item.toLowerCase() === payer.toLowerCase())) return res.status(400).json({ error: 'Payer already exists' });
  settings.payers.push(payer);
  writeJson(FILES.settings, settings);
  res.json(settings);
});

app.put('/api/payers/:index', auth, requireRole('admin','manager'), (req, res) => {
  const settings = readJson(FILES.settings, { payers: [], featureFlags: {} });
  settings.payers = settings.payers || [];
  const index = Number(req.params.index);
  const payer = String(req.body.payer || '').trim();
  if (!Number.isInteger(index) || index < 0 || index >= settings.payers.length) return res.status(404).json({ error: 'Payer not found' });
  if (!payer) return res.status(400).json({ error: 'Payer name is required' });
  if (settings.payers.some((item, itemIndex) => itemIndex !== index && item.toLowerCase() === payer.toLowerCase())) return res.status(400).json({ error: 'Payer already exists' });
  settings.payers[index] = payer;
  writeJson(FILES.settings, settings);
  res.json(settings);
});

app.delete('/api/payers/:index', auth, requireRole('admin','manager'), (req, res) => {
  const settings = readJson(FILES.settings, { payers: [], featureFlags: {} });
  settings.payers = settings.payers || [];
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= settings.payers.length) return res.status(404).json({ error: 'Payer not found' });
  settings.payers.splice(index, 1);
  writeJson(FILES.settings, settings);
  res.json(settings);
});


app.post('/api/inspections', auth, upload.array('files', 6), (req, res) => {
  const inspections = readJson(FILES.inspections, []);
  const files = (req.files || []).map(file => ({ id: uuidv4(), file: `/uploads/${file.filename}`, at: new Date().toISOString() }));
  const item = {
    id: uuidv4(),
    userId: req.user.id,
    userName: req.user.name,
    date: req.body.date || new Date().toISOString().slice(0,10),
    time: req.body.time || '',
    vehicleNumber: req.body.vehicleNumber || '',
    odometer: req.body.odometer || '',
    statuses: parseJsonField(req.body.statuses, {}),
    defects: req.body.defects || '',
    correctiveAction: req.body.correctiveAction || '',
    extraData: parseJsonField(req.body.extraData, {}),
    files,
    createdAt: new Date().toISOString()
  };
  inspections.push(item);
  writeJson(FILES.inspections, inspections);
  res.json(item);
});

app.put('/api/inspections/:id', auth, requireRole('admin'), (req, res) => {
  const inspections = readJson(FILES.inspections, []);
  const idx = inspections.findIndex(item => item.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Inspection not found' });
  inspections[idx] = { ...inspections[idx], ...req.body };
  writeJson(FILES.inspections, inspections);
  res.json(inspections[idx]);
});

app.delete('/api/inspections/:id', auth, requireRole('admin'), (req, res) => {
  const inspections = readJson(FILES.inspections, []);
  writeJson(FILES.inspections, inspections.filter(item => item.id !== req.params.id));
  res.json({ ok: true });
});

app.post('/api/incidents', auth, upload.array('files', 6), (req, res) => {
  const incidents = readJson(FILES.incidents, []);
  const files = (req.files || []).map(file => ({ id: uuidv4(), file: `/uploads/${file.filename}`, at: new Date().toISOString() }));
  const item = {
    id: uuidv4(),
    userId: req.user.id,
    userName: req.user.name,
    reportType: req.body.reportType || '',
    eventDate: req.body.eventDate || new Date().toISOString().slice(0,10),
    eventTime: req.body.eventTime || '',
    location: req.body.location || '',
    weather: req.body.weather || '',
    contactInfo: req.body.contactInfo || '',
    description: req.body.description || '',
    damagesInjuries: req.body.damagesInjuries || '',
    extraData: parseJsonField(req.body.extraData, {}),
    files,
    createdAt: new Date().toISOString()
  };
  incidents.push(item);
  writeJson(FILES.incidents, incidents);
  res.json(item);
});

app.put('/api/incidents/:id', auth, requireRole('admin'), (req, res) => {
  const incidents = readJson(FILES.incidents, []);
  const idx = incidents.findIndex(item => item.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Incident not found' });
  incidents[idx] = { ...incidents[idx], ...req.body };
  writeJson(FILES.incidents, incidents);
  res.json(incidents[idx]);
});

app.delete('/api/incidents/:id', auth, requireRole('admin'), (req, res) => {
  const incidents = readJson(FILES.incidents, []);
  writeJson(FILES.incidents, incidents.filter(item => item.id !== req.params.id));
  res.json({ ok: true });
});

app.get('/api/documents/daily', auth, requireRole('admin'), (req, res) => {
  const day = String(req.query.day || new Date().toISOString().slice(0,10));
  res.json({ day, files: listUploadedFilesForDay(day) });
});

app.put('/api/settings/chat-visible-users', auth, requireRole('admin'), (req, res) => {
  const settings = readJson(FILES.settings, { payers: [], featureFlags: {} });
  settings.chatVisibleUserIds = Array.isArray(req.body.userIds) ? req.body.userIds : [];
  writeJson(FILES.settings, settings);
  res.json(settings);
});

app.put('/api/settings/custom-fields', auth, requireRole('admin'), (req, res) => {
  const settings = readJson(FILES.settings, { payers: [], featureFlags: {} });
  settings.customTripFields = Array.isArray(req.body.customTripFields) ? req.body.customTripFields : settings.customTripFields || [];
  settings.inspectionExtraFields = Array.isArray(req.body.inspectionExtraFields) ? req.body.inspectionExtraFields : settings.inspectionExtraFields || [];
  settings.incidentExtraFields = Array.isArray(req.body.incidentExtraFields) ? req.body.incidentExtraFields : settings.incidentExtraFields || [];
  writeJson(FILES.settings, settings);
  res.json(settings);
});

app.post('/api/chat/send', auth, (req, res) => {
  const chat = readJson(FILES.chat, { channels: [], direct: [] });
  const toIds = Array.isArray(req.body.toIds) ? [...new Set(req.body.toIds.filter(v => typeof v === 'string' && v.trim()))] : [];
  const text = String(req.body.text || '').trim();
  if (!toIds.length) return res.status(400).json({ error: 'At least one recipient is required' });
  if (!text) return res.status(400).json({ error: 'Message text is required' });
  const msg = { id: uuidv4(), fromId: req.user.id, fromName: req.user.name, toIds, text, at: new Date().toISOString() };
  chat.direct.push(msg);
  writeJson(FILES.chat, chat);
  const recipients = [...new Set([msg.fromId, ...(Array.isArray(msg.toIds) ? msg.toIds : [])])];
  for (const userId of recipients) io.to('user:' + userId).emit('chat:new', msg);
  res.json(msg);
});

app.post('/api/location', auth, (req, res) => {
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'Invalid location' });
  if (!currentAttendance(req.user.id)) return res.status(409).json({ error: 'Clock in before sharing location' });
  const live = readJson(FILES.live, {});
  live[req.user.id] = { userId: req.user.id, name: req.user.name, role: req.user.role, lat, lng, at: new Date().toISOString() };
  writeJson(FILES.live, live);
  io.emit('location:update', live[req.user.id]);
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  if (err && (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_UNEXPECTED_FILE' || /Unsupported file type/.test(err.message || ''))) {
    return res.status(400).json({ error: err.message || 'Invalid upload' });
  }
  if (err) return res.status(500).json({ error: 'Server error' });
  return res.status(500).json({ error: 'Server error' });
});

app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TRINSIT rebuilt app running on ${PORT}`);
});
