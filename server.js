const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
let google;
try { google = require('googleapis').google; } catch (e) { google = null; }

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'trinsit-super-secret-change-me';
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

function ensureFile(name, initialValue) {
  const filePath = path.join(DATA_DIR, name);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, JSON.stringify(initialValue, null, 2));
}
function readJson(name) { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')); }
function writeJson(name, value) { fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(value, null, 2)); }

ensureFile('users.json', []);
ensureFile('trips.json', []);
ensureFile('attendance.json', []);
ensureFile('priceSettings.json', {
  services: { ambulatory: 60, wheelchair: 110, stretcher: 220, climbing_stairs_chair: 180, own_wheelchair: 95 },
  mileageTiers: [{ upTo: 10, rate: 0 }, { upTo: 39, rate: 4 }, { upTo: 99, rate: 5.5 }, { upTo: 9999, rate: 7.6 }],
  bariatricThreshold: 250,
  weightSurcharge: 140,
  oxygen: { base: 25, perLiter: 7 },
  extraStop: 40
});
ensureFile('equipment.json', []);
ensureFile('incidents.json', []);
ensureFile('inspections.json', []);
ensureFile('expenses.json', []);
ensureFile('gps.json', {});
ensureFile('notifications.json', []);
ensureFile('messages.json', []);

const tripWorkflow = ['assigned', 'received', 'trip_in_progress', 'arrived', 'facesheet_uploaded', 'leaving_with_patient', 'drop_off', 'completed'];

function seedUsers() {
  const users = readJson('users.json');
  if (users.length) return;
  const defaultUsers = [
    { id: uuidv4(), name: 'Admin User', email: 'admin@trinsit.local', passwordHash: bcrypt.hashSync('Admin123!', 10), role: 'admin', active: true },
    { id: uuidv4(), name: 'Manager User', email: 'manager@trinsit.local', passwordHash: bcrypt.hashSync('Manager123!', 10), role: 'manager', active: true },
    { id: uuidv4(), name: 'Dispatcher User', email: 'dispatcher@trinsit.local', passwordHash: bcrypt.hashSync('Dispatcher123!', 10), role: 'dispatcher', active: true },
    { id: uuidv4(), name: 'Driver User', email: 'driver@trinsit.local', passwordHash: bcrypt.hashSync('Driver123!', 10), role: 'driver', active: true },
    { id: uuidv4(), name: 'Contract Driver', email: 'contractor@trinsit.local', passwordHash: bcrypt.hashSync('Contract123!', 10), role: 'contractor_driver', active: true }
  ];
  writeJson('users.json', defaultUsers);
}
seedUsers();

const onlineUsers = new Map();
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 15 * 1024 * 1024, files: 8 } });

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const users = readJson('users.json');
    const user = users.find(u => u.id === payload.userId);
    if (!user) return res.status(401).json({ error: 'Invalid token user' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
function roleRequired(...roles) { return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Forbidden' }); }

function sanitizeTripForRole(trip, role) {
  if (role === 'driver' || role === 'contractor_driver') {
    const { payer, dateOfBirth, mrn, ...allowed } = trip;
    return allowed;
  }
  return trip;
}
function createNotification(userIds, title, body, type = 'info', extra = {}) {
  const notifications = readJson('notifications.json');
  const batch = userIds.map(userId => ({ id: uuidv4(), userId, title, body, type, read: false, createdAt: new Date().toISOString(), ...extra }));
  writeJson('notifications.json', [...batch, ...notifications].slice(0, 1000));
  batch.forEach(item => io.to(item.userId).emit('notification', item));
}
function calcMileagePrice(miles, settings) {
  let remaining = miles, previousCap = 0, total = 0;
  for (const tier of settings.mileageTiers) {
    const milesInTier = Math.max(Math.min(remaining, tier.upTo - previousCap), 0);
    total += milesInTier * tier.rate;
    remaining -= milesInTier;
    previousCap = tier.upTo;
    if (remaining <= 0) break;
  }
  return total;
}
function calculateTripPrice(payload, settings) {
  const serviceKey = (payload.service || '').toLowerCase().replace(/ /g, '_');
  const base = settings.services[serviceKey] || 0;
  const miles = Number(payload.mileage || 0);
  const weight = Number(payload.weight || 0);
  const oxygenLiters = payload.oxygen === true || payload.oxygen === 'Yes' ? Number(payload.oxygenLiters || 0) : 0;
  const stops = payload.additionalStops || [];
  const mileageFee = calcMileagePrice(miles, settings);
  const weightFee = weight >= settings.bariatricThreshold ? settings.weightSurcharge : 0;
  const oxygenFee = oxygenLiters > 0 ? settings.oxygen.base + oxygenLiters * settings.oxygen.perLiter : 0;
  const stopFee = stops.length * settings.extraStop;
  const total = base + mileageFee + weightFee + oxygenFee + stopFee;
  return { base, mileageFee, weightFee, oxygenFee, stopFee, total };
}
function latestAttendanceForUser(userId) {
  return readJson('attendance.json').find(a => a.userId === userId);
}
function isUserClockedIn(userId) {
  const latest = latestAttendanceForUser(userId);
  if (!latest) return false;
  return latest.type === 'clock_in' || latest.type === 'lunch_in';
}
function parseJsonField(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

async function uploadFileToGoogleDrive(localPath, originalName, mimeType) {
  if (!google || !process.env.GOOGLE_DRIVE_CLIENT_EMAIL || !process.env.GOOGLE_DRIVE_PRIVATE_KEY || !process.env.GOOGLE_DRIVE_FOLDER_ID) {
    return null;
  }
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_DRIVE_CLIENT_EMAIL,
    key: process.env.GOOGLE_DRIVE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/drive.file']
  });
  const drive = google.drive({ version: 'v3', auth });
  const response = await drive.files.create({
    requestBody: { name: `${Date.now()}-${originalName}`, parents: [process.env.GOOGLE_DRIVE_FOLDER_ID] },
    media: { mimeType, body: fs.createReadStream(localPath) },
    fields: 'id, webViewLink, webContentLink'
  });
  return { fileId: response.data.id, viewLink: response.data.webViewLink || '', downloadLink: response.data.webContentLink || '' };
}
async function buildStoredFile(file) {
  const localUrl = `/uploads/${path.basename(file.path)}`;
  let drive = null;
  try {
    drive = await uploadFileToGoogleDrive(file.path, file.originalname, file.mimetype);
  } catch (err) {
    console.error('Google Drive upload failed:', err.message);
  }
  return {
    id: uuidv4(),
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    localUrl,
    storage: drive ? 'google_drive' : 'local',
    googleDrive: drive,
    uploadedAt: new Date().toISOString()
  };
}

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const users = readJson('users.json');
  const user = users.find(u => u.email.toLowerCase() === String(email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) return res.status(401).json({ error: 'Invalid email or password' });
  const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});
app.get('/api/me', authRequired, (req, res) => res.json({ id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role }));
app.get('/api/users', authRequired, roleRequired('admin', 'manager', 'dispatcher'), (req, res) => res.json(readJson('users.json').map(({ passwordHash, ...u }) => u)));
app.post('/api/users', authRequired, roleRequired('admin'), (req, res) => {
  const users = readJson('users.json');
  const user = { id: uuidv4(), name: req.body.name, email: req.body.email, passwordHash: bcrypt.hashSync(req.body.password || 'Temp123!', 10), role: req.body.role, active: true };
  users.push(user); writeJson('users.json', users); const { passwordHash, ...safe } = user; res.status(201).json(safe);
});

app.get('/api/price-settings', authRequired, (req, res) => res.json(readJson('priceSettings.json')));
app.put('/api/price-settings', authRequired, roleRequired('admin'), (req, res) => { writeJson('priceSettings.json', req.body); res.json(req.body); });
app.post('/api/pricing/calculate', authRequired, (req, res) => res.json(calculateTripPrice(req.body, readJson('priceSettings.json'))));

app.get('/api/trips', authRequired, (req, res) => {
  const trips = readJson('trips.json');
  let filtered = trips;
  if (req.user.role === 'driver' || req.user.role === 'contractor_driver') filtered = trips.filter(t => t.assignedDriverId === req.user.id);
  res.json(filtered.map(t => sanitizeTripForRole(t, req.user.role)));
});
app.post('/api/trips', authRequired, roleRequired('admin', 'manager', 'dispatcher'), (req, res) => {
  const trips = readJson('trips.json');
  const settings = readJson('priceSettings.json');
  const priceBreakdown = calculateTripPrice(req.body, settings);
  const trip = {
    id: uuidv4(),
    pickupDate: req.body.pickupDate, pickupTime: req.body.pickupTime, patientName: req.body.patientName,
    pickupLocation: req.body.pickupLocation, roomNumber: req.body.roomNumber, service: req.body.service,
    weight: Number(req.body.weight || 0), dropoffLocation: req.body.dropoffLocation,
    additionalStops: req.body.additionalStops || [], oxygen: req.body.oxygen, oxygenLiters: Number(req.body.oxygenLiters || 0),
    caregiverOnBoard: req.body.caregiverOnBoard, caregiverCount: Number(req.body.caregiverCount || 0), note: req.body.note,
    dateOfBirth: req.body.dateOfBirth, mrn: req.body.mrn, payer: req.body.payer, mileage: Number(req.body.mileage || 0),
    priceBreakdown, assignedDriverId: req.body.assignedDriverId || null, status: req.body.assignedDriverId ? 'assigned' : 'open',
    workflow: { receivedAt: null, tripInProgressAt: null, arrivedAt: null, facesheetUploadedAt: null, leavingWithPatientAt: null, dropOffAt: null, completedAt: null },
    facesheetFiles: [], createdBy: req.user.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  trips.unshift(trip); writeJson('trips.json', trips);
  if (trip.assignedDriverId) createNotification([trip.assignedDriverId], 'New Trip Assigned', `${trip.patientName} - ${trip.pickupDate} ${trip.pickupTime}`, 'trip', { tripId: trip.id });
  io.emit('trip:created', trip); res.status(201).json(trip);
});
app.put('/api/trips/:id', authRequired, roleRequired('admin', 'manager', 'dispatcher', 'driver', 'contractor_driver'), (req, res) => {
  const trips = readJson('trips.json');
  const index = trips.findIndex(t => t.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Trip not found' });
  const current = trips[index];
  if ((req.user.role === 'driver' || req.user.role === 'contractor_driver') && current.assignedDriverId !== req.user.id) return res.status(403).json({ error: 'Trip not assigned to you' });
  const nextStatus = req.body.status;
  if ((req.user.role === 'driver' || req.user.role === 'contractor_driver') && nextStatus && nextStatus !== current.status) {
    if (!isUserClockedIn(req.user.id)) return res.status(400).json({ error: 'Driver must clock in before starting trip workflow' });
    const currentIndex = tripWorkflow.indexOf(current.status);
    const nextIndex = tripWorkflow.indexOf(nextStatus);
    if (nextIndex !== -1 && currentIndex !== -1 && nextIndex !== currentIndex + 1) return res.status(400).json({ error: 'Trip steps must be completed in order' });
    if (nextStatus === 'facesheet_uploaded' && !(current.facesheetFiles || []).length) return res.status(400).json({ error: 'Upload facesheet before selecting this step' });
  }
  const updated = { ...current, ...req.body, updatedAt: new Date().toISOString() };
  updated.workflow = updated.workflow || current.workflow || {};
  const stampMap = { received: 'receivedAt', trip_in_progress: 'tripInProgressAt', arrived: 'arrivedAt', facesheet_uploaded: 'facesheetUploadedAt', leaving_with_patient: 'leavingWithPatientAt', drop_off: 'dropOffAt', completed: 'completedAt' };
  if (stampMap[nextStatus]) updated.workflow[stampMap[nextStatus]] = new Date().toISOString();
  trips[index] = updated; writeJson('trips.json', trips); io.emit('trip:updated', updated); res.json(sanitizeTripForRole(updated, req.user.role));
});
app.post('/api/trips/:id/facesheet', authRequired, roleRequired('driver', 'contractor_driver', 'admin', 'manager', 'dispatcher'), upload.single('file'), async (req, res) => {
  const trips = readJson('trips.json');
  const index = trips.findIndex(t => t.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Trip not found' });
  if (!req.file) return res.status(400).json({ error: 'Facesheet file required' });
  const trip = trips[index];
  if ((req.user.role === 'driver' || req.user.role === 'contractor_driver') && trip.assignedDriverId !== req.user.id) return res.status(403).json({ error: 'Trip not assigned to you' });
  const fileMeta = await buildStoredFile(req.file);
  trip.facesheetFiles = [...(trip.facesheetFiles || []), fileMeta];
  trip.updatedAt = new Date().toISOString();
  trips[index] = trip; writeJson('trips.json', trips); io.emit('trip:updated', trip); res.status(201).json(fileMeta);
});

app.post('/api/attendance/clock', authRequired, (req, res) => {
  const attendance = readJson('attendance.json');
  const event = { id: uuidv4(), userId: req.user.id, name: req.user.name, role: req.user.role, type: req.body.type, lat: req.body.lat, lng: req.body.lng, accuracy: req.body.accuracy, createdAt: new Date().toISOString() };
  attendance.unshift(event); writeJson('attendance.json', attendance.slice(0, 5000)); res.status(201).json(event);
});
app.get('/api/attendance', authRequired, roleRequired('admin', 'manager', 'dispatcher'), (req, res) => res.json(readJson('attendance.json')));

app.post('/api/gps/update', authRequired, (req, res) => {
  const gps = readJson('gps.json');
  gps[req.user.id] = { userId: req.user.id, name: req.user.name, role: req.user.role, lat: req.body.lat, lng: req.body.lng, accuracy: req.body.accuracy, tripId: req.body.tripId || null, updatedAt: new Date().toISOString() };
  writeJson('gps.json', gps); io.emit('gps:update', gps[req.user.id]); res.json(gps[req.user.id]);
});
app.get('/api/gps', authRequired, roleRequired('admin', 'manager', 'dispatcher'), (req, res) => res.json(Object.values(readJson('gps.json'))));

app.get('/api/equipment', authRequired, (req, res) => res.json(readJson('equipment.json')));
app.post('/api/equipment', authRequired, roleRequired('admin'), (req, res) => {
  const equipment = readJson('equipment.json');
  const item = { id: uuidv4(), ...req.body, createdAt: new Date().toISOString() };
  equipment.unshift(item); writeJson('equipment.json', equipment); res.status(201).json(item);
});

app.get('/api/expenses', authRequired, (req, res) => {
  const expenses = readJson('expenses.json');
  if (['driver', 'contractor_driver'].includes(req.user.role)) return res.json(expenses.filter(x => x.userId === req.user.id));
  res.json(expenses);
});
app.post('/api/expenses', authRequired, upload.single('receipt'), async (req, res) => {
  const expenses = readJson('expenses.json');
  const receipt = req.file ? await buildStoredFile(req.file) : null;
  const item = { id: uuidv4(), userId: req.user.id, userName: req.user.name, description: req.body.description, expenseDate: req.body.expenseDate, amount: Number(req.body.amount || 0), receipt, createdAt: new Date().toISOString() };
  expenses.unshift(item); writeJson('expenses.json', expenses); res.status(201).json(item);
});

app.get('/api/incidents', authRequired, (req, res) => {
  const incidents = readJson('incidents.json');
  if (['driver', 'contractor_driver'].includes(req.user.role)) return res.json(incidents.filter(i => i.userId === req.user.id));
  res.json(incidents);
});
app.post('/api/incidents', authRequired, upload.array('images', 4), async (req, res) => {
  const incidents = readJson('incidents.json');
  const images = [];
  for (const file of (req.files || [])) images.push(await buildStoredFile(file));
  const item = { id: uuidv4(), userId: req.user.id, userName: req.user.name, tripId: req.body.tripId || '', category: req.body.category, summary: req.body.summary, details: req.body.details, images, createdAt: new Date().toISOString() };
  incidents.unshift(item); writeJson('incidents.json', incidents); res.status(201).json(item);
});

app.get('/api/inspections', authRequired, (req, res) => res.json(readJson('inspections.json')));
app.post('/api/inspections', authRequired, upload.array('images', 6), async (req, res) => {
  const inspections = readJson('inspections.json');
  const images = [];
  for (const file of (req.files || [])) images.push(await buildStoredFile(file));
  const item = { id: uuidv4(), userId: req.user.id, userName: req.user.name, vehicleUnit: req.body.vehicleUnit, odometer: req.body.odometer, tires: req.body.tires, brakes: req.body.brakes, lights: req.body.lights, ramp: req.body.ramp, notes: req.body.notes, images, createdAt: new Date().toISOString() };
  inspections.unshift(item); writeJson('inspections.json', inspections); res.status(201).json(item);
});

app.get('/api/notifications', authRequired, (req, res) => res.json(readJson('notifications.json').filter(n => n.userId === req.user.id)));
app.post('/api/notifications/:id/read', authRequired, (req, res) => {
  const notifications = readJson('notifications.json');
  const idx = notifications.findIndex(n => n.id === req.params.id && n.userId === req.user.id);
  if (idx !== -1) notifications[idx].read = true;
  writeJson('notifications.json', notifications); res.json({ ok: true });
});
app.get('/api/messages', authRequired, (req, res) => res.json(readJson('messages.json').slice(0, 200)));
app.post('/api/messages', authRequired, (req, res) => {
  const messages = readJson('messages.json');
  const message = { id: uuidv4(), userId: req.user.id, userName: req.user.name, role: req.user.role, text: req.body.text, createdAt: new Date().toISOString() };
  messages.unshift(message); writeJson('messages.json', messages.slice(0, 500)); io.emit('chat:message', message); res.status(201).json(message);
});

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Missing token'));
    const payload = jwt.verify(token, JWT_SECRET);
    const user = readJson('users.json').find(u => u.id === payload.userId);
    if (!user) return next(new Error('Invalid user'));
    socket.user = { id: user.id, name: user.name, role: user.role };
    next();
  } catch (err) { next(new Error('Unauthorized')); }
});
io.on('connection', socket => {
  onlineUsers.set(socket.user.id, socket.id); socket.join(socket.user.id); io.emit('presence:update', Array.from(onlineUsers.keys()));
  socket.on('disconnect', () => { onlineUsers.delete(socket.user.id); io.emit('presence:update', Array.from(onlineUsers.keys())); });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
server.listen(PORT, '0.0.0.0', () => console.log(`TRINSIT app running on port ${PORT}`));
