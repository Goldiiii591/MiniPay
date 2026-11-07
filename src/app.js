// src/app.js
// WHY THIS EXISTS:
// Separating the Express `app` definition from `server.js` (which calls `app.listen()`)
// enables automated integration testing without having to start a real HTTP server on a port.
// It also sets up standard middleware like JSON parsing and the global error handler.

const express = require('express');
const authRoutes = require('./routes/authRoutes');
const walletRoutes = require('./routes/walletRoutes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Parse JSON bodies (standard for REST APIs)
app.use(express.json());

// Healthcheck route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'MiniPay', timestamp: new Date().toISOString() });
});

// Mount routes
app.use('/', authRoutes);
app.use('/wallet', walletRoutes);

// 404 Route Not Found handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`
  });
});

// Centralized error handler (must be last)
app.use(errorHandler);

module.exports = app;
