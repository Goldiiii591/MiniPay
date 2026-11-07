// src/server.js
// WHY THIS EXISTS:
// Entry point for the MiniPay backend.
// 1. Bootstraps the database tables (initSchema).
// 2. Starts the Express HTTP listener on the configured port.
// 3. Handles graceful shutdown (SIGINT/SIGTERM) to flush SQLite WAL logs cleanly.

const app = require('./app');
const config = require('./config');
const db = require('./db/connection');
const { initSchema } = require('./db/schema');

// 1. Initialize database schema
initSchema();
console.log('✅ SQLite database schema initialized successfully.');

// 2. Start HTTP server
const server = app.listen(config.port, () => {
  console.log(`🚀 MiniPay server running at http://localhost:${config.port}`);
  console.log(`📦 Database path: ${config.dbPath}`);
  console.log(`💡 Mode: ${config.nodeEnv}`);
});

// 3. Graceful shutdown handler
function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  server.close(() => {
    console.log('HTTP server closed.');
    try {
      db.close();
      console.log('Database connection closed.');
    } catch (err) {
      console.error('Error closing database:', err.message);
    }
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
