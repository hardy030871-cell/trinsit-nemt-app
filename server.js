require('dotenv').config();

const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

let trips = [
  {
    id: 'trip_001',
    patientName: 'John Doe',
    pickup: 'Ocala Regional Medical Center',
    dropoff: 'Palm Garden Nursing Home',
    status: 'Scheduled',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'trip_002',
    patientName: 'Jane Smith',
    pickup: 'AdventHealth Daytona',
    dropoff: 'Home Address',
    status: 'Received',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

const validStatuses = [
  'Scheduled',
  'Received',
  'Leaving for pickup',
  'Arrived for pickup',
  'En route to drop-off',
  'Complete'
];

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    message: 'Server is healthy',
    env: NODE_ENV,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ ok: true, message: 'API is healthy' });
});

app.get('/api/trips', (req, res) => {
  res.status(200).json({ ok: true, count: trips.length, trips });
});

app.get('/api/trips/:tripId', (req, res) => {
  const trip = trips.find((t) => t.id === req.params.tripId);
  if (!trip) {
    return res.status(404).json({ ok: false, message: 'Trip not found' });
  }
  res.status(200).json({ ok: true, trip });
});

app.post('/api/trips', (req, res) => {
  const { patientName, pickup, dropoff, status } = req.body;
  if (!patientName || !pickup || !dropoff) {
    return res.status(400).json({
      ok: false,
      message: 'patientName, pickup, and dropoff are required'
    });
  }

  const newTrip = {
    id: `trip_${Date.now()}`,
    patientName,
    pickup,
    dropoff,
    status: validStatuses.includes(status) ? status : 'Scheduled',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  trips.unshift(newTrip);
  res.status(201).json({ ok: true, message: 'Trip created successfully', trip: newTrip });
});

app.post('/api/trips/:tripId/status', (req, res) => {
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ ok: false, message: 'status is required' });
  }

  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      ok: false,
      message: `Invalid status. Allowed values: ${validStatuses.join(', ')}`
    });
  }

  const idx = trips.findIndex((t) => t.id === req.params.tripId);
  if (idx === -1) {
    return res.status(404).json({ ok: false, message: 'Trip not found' });
  }

  trips[idx].status = status;
  trips[idx].updatedAt = new Date().toISOString();

  res.status(200).json({ ok: true, message: 'Trip status updated successfully', trip: trips[idx] });
});

app.put('/api/trips/:tripId', (req, res) => {
  const idx = trips.findIndex((t) => t.id === req.params.tripId);
  if (idx === -1) {
    return res.status(404).json({ ok: false, message: 'Trip not found' });
  }

  const { patientName, pickup, dropoff, status } = req.body;
  if (patientName !== undefined) trips[idx].patientName = patientName;
  if (pickup !== undefined) trips[idx].pickup = pickup;
  if (dropoff !== undefined) trips[idx].dropoff = dropoff;
  if (status !== undefined) {
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        ok: false,
        message: `Invalid status. Allowed values: ${validStatuses.join(', ')}`
      });
    }
    trips[idx].status = status;
  }

  trips[idx].updatedAt = new Date().toISOString();
  res.status(200).json({ ok: true, message: 'Trip updated successfully', trip: trips[idx] });
});

app.delete('/api/trips/:tripId', (req, res) => {
  const before = trips.length;
  trips = trips.filter((t) => t.id !== req.params.tripId);
  if (trips.length === before) {
    return res.status(404).json({ ok: false, message: 'Trip not found' });
  }
  res.status(200).json({ ok: true, message: 'Trip deleted successfully' });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((req, res) => {
  res.status(404).json({ ok: false, message: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error('UNCAUGHT APP ERROR:', err);
  res.status(err.status || 500).json({ ok: false, message: err.message || 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
