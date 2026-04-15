require("dotenv").config();

const express = require("express");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const app = express();

/**
 * CONFIG
 */
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";

/**
 * IN-MEMORY DATA
 * Replace this later with your database.
 */
let trips = [
  {
    id: "trip_001",
    patientName: "John Doe",
    pickup: "Ocala Regional Medical Center",
    dropoff: "Palm Garden Nursing Home",
    status: "Scheduled",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "trip_002",
    patientName: "Jane Smith",
    pickup: "AdventHealth Daytona",
    dropoff: "Home Address",
    status: "Received",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

const validStatuses = [
  "Scheduled",
  "Received",
  "Leaving for pickup",
  "Arrived for pickup",
  "En route to drop-off",
  "Complete"
];

/**
 * MIDDLEWARE
 */
app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

/**
 * REQUEST LOGGER
 */
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

/**
 * HEALTH CHECKS
 * These help hosting platforms know the app is alive.
 */
app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    message: "Server is healthy",
    env: NODE_ENV,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get("/api/health", (req, res) => {
  res.status(200).json({
    ok: true,
    message: "API is healthy"
  });
});

/**
 * ROOT
 */
app.get("/", (req, res) => {
  res.status(200).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
      <title>TRINSIT Server</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background: #ffffff;
          color: #111111;
          padding: 40px;
        }
        .card {
          max-width: 700px;
          margin: 40px auto;
          border: 1px solid #e5e5e5;
          border-radius: 12px;
          padding: 24px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.06);
        }
        h1 { margin-top: 0; }
        code {
          background: #f4f4f4;
          padding: 2px 6px;
          border-radius: 6px;
        }
        a {
          color: #c1121f;
          text-decoration: none;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>TRINSIT Backend Running</h1>
        <p>Your server is live.</p>
        <p>Check <a href="/health">/health</a> or <a href="/api/trips">/api/trips</a></p>
      </div>
    </body>
    </html>
  `);
});

/**
 * API ROUTES
 */

// get all trips
app.get("/api/trips", (req, res) => {
  res.status(200).json({
    ok: true,
    count: trips.length,
    trips
  });
});

// get one trip
app.get("/api/trips/:tripId", (req, res) => {
  const { tripId } = req.params;
  const trip = trips.find((t) => t.id === tripId);

  if (!trip) {
    return res.status(404).json({
      ok: false,
      message: "Trip not found"
    });
  }

  return res.status(200).json({
    ok: true,
    trip
  });
});

// create trip
app.post("/api/trips", (req, res) => {
  const { patientName, pickup, dropoff, status } = req.body;

  if (!patientName || !pickup || !dropoff) {
    return res.status(400).json({
      ok: false,
      message: "patientName, pickup, and dropoff are required"
    });
  }

  const newTrip = {
    id: `trip_${Date.now()}`,
    patientName,
    pickup,
    dropoff,
    status: validStatuses.includes(status) ? status : "Scheduled",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  trips.unshift(newTrip);

  return res.status(201).json({
    ok: true,
    message: "Trip created successfully",
    trip: newTrip
  });
});

// update trip status
app.post("/api/trips/:tripId/status", (req, res) => {
  const { tripId } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({
      ok: false,
      message: "status is required"
    });
  }

  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      ok: false,
      message: `Invalid status. Allowed values: ${validStatuses.join(", ")}`
    });
  }

  const tripIndex = trips.findIndex((t) => t.id === tripId);

  if (tripIndex === -1) {
    return res.status(404).json({
      ok: false,
      message: "Trip not found"
    });
  }

  trips[tripIndex].status = status;
  trips[tripIndex].updatedAt = new Date().toISOString();

  return res.status(200).json({
    ok: true,
    message: "Trip status updated successfully",
    trip: trips[tripIndex]
  });
});

// full trip update
app.put("/api/trips/:tripId", (req, res) => {
  const { tripId } = req.params;
  const { patientName, pickup, dropoff, status } = req.body;

  const tripIndex = trips.findIndex((t) => t.id === tripId);

  if (tripIndex === -1) {
    return res.status(404).json({
      ok: false,
      message: "Trip not found"
    });
  }

  if (patientName !== undefined) trips[tripIndex].patientName = patientName;
  if (pickup !== undefined) trips[tripIndex].pickup = pickup;
  if (dropoff !== undefined) trips[tripIndex].dropoff = dropoff;
  if (status !== undefined) {
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        ok: false,
        message: `Invalid status. Allowed values: ${validStatuses.join(", ")}`
      });
    }
    trips[tripIndex].status = status;
  }

  trips[tripIndex].updatedAt = new Date().toISOString();

  return res.status(200).json({
    ok: true,
    message: "Trip updated successfully",
    trip: trips[tripIndex]
  });
});

// delete trip
app.delete("/api/trips/:tripId", (req, res) => {
  const { tripId } = req.params;
  const originalLength = trips.length;
  trips = trips.filter((t) => t.id !== tripId);

  if (trips.length === originalLength) {
    return res.status(404).json({
      ok: false,
      message: "Trip not found"
    });
  }

  return res.status(200).json({
    ok: true,
    message: "Trip deleted successfully"
  });
});

/**
 * FRONTEND STATIC FILES
 * If you have a build folder from your frontend, enable this.
 * Example:
 * const frontendPath = path.join(__dirname, "dist");
 * app.use(express.static(frontendPath));
 * app.get("*", (req, res) => {
 *   res.sendFile(path.join(frontendPath, "index.html"));
 * });
 */

/**
 * 404 HANDLER
 */
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    message: "Route not found"
  });
});

/**
 * GLOBAL ERROR HANDLER
 */
app.use((err, req, res, next) => {
  console.error("UNCAUGHT APP ERROR:", err);

  res.status(err.status || 500).json({
    ok: false,
    message: err.message || "Internal server error"
  });
});

/**
 * START SERVER
 */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
