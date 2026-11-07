// src/app.js
// WHY THIS EXISTS:
// Separating the Express `app` definition from `server.js` (which calls `app.listen()`)
// enables automated integration testing without having to start a real HTTP server on a port.
// It sets up static file serving for the frontend before mounting API routes and the 404 handler.

const express = require('express');
const path = require('path');
const authRoutes = require('./routes/authRoutes');
const walletRoutes = require('./routes/walletRoutes');
const transferRoutes = require('./routes/transferRoutes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

const publicPath = path.join(__dirname, '..', 'public');

// Parse JSON bodies (standard for REST APIs)
app.use(express.json());

// 1. Serve static frontend files from public/ folder (registered BEFORE 404 handler)
app.use(express.static(publicPath));

// Explicit route to serve index.html for root path GET /
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Healthcheck route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'MiniPay', timestamp: new Date().toISOString() });
});

// 2. Mount API routes
app.use('/', authRoutes);
app.use('/wallet', walletRoutes);
app.use('/', transferRoutes);

// 3. 404 Route Not Found handler (must be placed AFTER static files and API routes)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`
  });
});

// Centralized error handler (must be last)
app.use(errorHandler);

module.exports = app;
