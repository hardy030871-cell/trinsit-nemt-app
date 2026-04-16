const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const multer = require('multer');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

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
  chat: path.join(DATA_DIR, 'chat.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  live: path.join(DATA_DIR, 'liveLocations.json')
};

const DEFAULT_USERS = [
  { id: 'u-admin', name: 'TRINSIT Admin', role: 'admin', pin: '001900!', active: true, contractorPermission: true, phone: '', address: '', dob: '', status: 'available' },
  { id: 'u-dispatch', name: 'Dispatcher One', role: 'dispatcher', pin: '222222!', active: true, contractorPermission: false, phone: '', address: '', dob: '', status: 'available' },
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
      role: defaultUser.role,
      pin: normalizePin(defaultUser.pin),
      active: true,
      contractorPermission: defaultUser.contractorPermission,
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
    }
  };
  ensureArrayData(FILES.users, DEFAULT_USERS.map(user => ({ ...user, createdAt: new Date().toISOString() })));
  repairDefaultUsers();
  ensureArrayData(FILES.trips, defaultTrips);
  ensureArrayData(FILES.attendance, []);
  ensureArrayData(FILES.expenses, []);
  ensureArrayData(FILES.equipment, defaultEquipment);
  const chatSeed = readJson(FILES.chat, { channels: [], direct: [] });
  if (!chatSeed || typeof chatSeed !== 'object' || !Array.isArray(chatSeed.direct) || !Array.isArray(chatSeed.channels)) writeJson(FILES.chat, { channels: [], direct: [] });
  const settingsSeed = readJson(FILES.settings, defaultSettings);
  if (!settingsSeed || typeof settingsSeed !== 'object' || !Array.isArray(settingsSeed.payers)) writeJson(FILES.settings, defaultSettings);
  const liveSeed = readJson(FILES.live, {});
  if (!liveSeed || typeof liveSeed !== 'object' || Array.isArray(liveSeed)) writeJson(FILES.live, {});
}
seed();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g,'_')}`)
});
const upload = multer({ storage });

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(PUBLIC_DIR));

function makeToken(user) {
  return Buffer.from(`${user.id}|${user.role}|${Date.now()}`).toString('base64url');
}
function parseToken(token) {
  try {
    const [id] = Buffer.from(token, 'base64url').toString('utf8').split('|');
    return id;
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
  const trips = readJson(FILES.trips, []);
  const attendance = readJson(FILES.attendance, []);
  const expenses = readJson(FILES.expenses, []);
  const equipment = readJson(FILES.equipment, []);
  const settings = readJson(FILES.settings, {});
  const liveLocations = pruneLiveLocations(readJson(FILES.live, {}));
  const chat = readJson(FILES.chat, { channels: [], direct: [] });
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
  const nextUsers = users.filter(u => u.id !== req.params.id);
  writeJson(FILES.users, nextUsers);
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
    caregiverCount: body.caregiverCount || '',
    otherStop: body.otherStop || '',
    payer: body.payer || '',
    notes: body.notes || '',
    mileage: body.mileage || '',
    status: 'assigned',
    driverIds: body.driverIds || [],
    tripLogs: [{ status: 'assigned', at: new Date().toISOString(), by: req.user.id }],
    facesheetFiles: [],
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

app.post('/api/trips/assign', auth, requireRole('admin','dispatcher','manager'), (req, res) => {
  const { tripId, driverIds } = req.body;
  const trips = readJson(FILES.trips, []);
  const trip = trips.find(t => t.id === tripId);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  trip.driverIds = Array.isArray(driverIds) ? driverIds.slice(0, 2) : [];
  trip.tripLogs.push({ status: 'assigned', at: new Date().toISOString(), by: req.user.id, driverIds: trip.driverIds });
  writeJson(FILES.trips, trips);
  io.emit('trip:assigned', trip);
  res.json(trip);
});

app.post('/api/trips/:id/status', auth, requireRole('driver','contractor_driver','admin','dispatcher','manager'), (req, res) => {
  const allowed = ['trip_in_progress','arrived_pickup','leaving_with_patient','completed','cancelled'];
  const { status } = req.body;
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const trips = readJson(FILES.trips, []);
  const trip = trips.find(t => t.id === req.params.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  trip.status = status;
  trip.tripLogs = trip.tripLogs || [];
  trip.tripLogs.push({ status, at: new Date().toISOString(), by: req.user.id });
  writeJson(FILES.trips, trips);
  io.emit('trip:updated', trip);
  res.json({ trip });
});

app.post('/api/trips/:id/facesheet', auth, upload.single('file'), (req, res) => {
  const trips = readJson(FILES.trips, []);
  const trip = trips.find(t => t.id === req.params.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  trip.facesheetFiles = trip.facesheetFiles || [];
  trip.facesheetFiles.push({ id: uuidv4(), file: `/uploads/${req.file.filename}`, at: new Date().toISOString(), by: req.user.id });
  trip.tripLogs.push({ status: 'facesheet_uploaded', at: new Date().toISOString(), by: req.user.id });
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

app.post('/api/payers', auth, requireRole('admin'), (req, res) => {
  const settings = readJson(FILES.settings, { payers: [], featureFlags: {} });
  const payer = String(req.body.payer || '').trim();
  if (!payer) return res.status(400).json({ error: 'Payer name is required' });
  settings.payers = settings.payers || [];
  if (settings.payers.some(item => item.toLowerCase() === payer.toLowerCase())) return res.status(400).json({ error: 'Payer already exists' });
  settings.payers.push(payer);
  writeJson(FILES.settings, settings);
  res.json(settings);
});

app.put('/api/payers/:index', auth, requireRole('admin'), (req, res) => {
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

app.delete('/api/payers/:index', auth, requireRole('admin'), (req, res) => {
  const settings = readJson(FILES.settings, { payers: [], featureFlags: {} });
  settings.payers = settings.payers || [];
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= settings.payers.length) return res.status(404).json({ error: 'Payer not found' });
  settings.payers.splice(index, 1);
  writeJson(FILES.settings, settings);
  res.json(settings);
});

app.post('/api/chat/send', auth, (req, res) => {
  const chat = readJson(FILES.chat, { channels: [], direct: [] });
  const msg = { id: uuidv4(), fromId: req.user.id, fromName: req.user.name, toIds: req.body.toIds || [], text: req.body.text, at: new Date().toISOString() };
  chat.direct.push(msg);
  writeJson(FILES.chat, chat);
  io.emit('chat:new', msg);
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

app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TRINSIT rebuilt app running on ${PORT}`);
});
