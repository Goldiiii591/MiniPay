// src/db/connection.js
// WHY THIS EXISTS:
// Manages the SQLite database connection using better-sqlite3.
// 1. Singleton connection: Avoids multiple file locks or connection leaks.
// 2. PRAGMA foreign_keys = ON: SQLite disables foreign key constraint checks by default for backwards compatibility.
//    In a financial ledger system, foreign keys are essential to prevent orphaned wallets, transactions, or ledger entries.
// 3. PRAGMA journal_mode = WAL: Write-Ahead Logging allows concurrent readers and writers without lock contention,
//    which is critical for high-throughput transactional systems.

const Database = require('better-sqlite3');
const config = require('../config');

// Initialize the SQLite database connection with the configured file path
const db = new Database(config.dbPath, {
  // verbose: config.nodeEnv === 'development' ? console.log : null // Can enable for SQL logging if needed
});

// Enforce foreign key constraints
db.pragma('foreign_keys = ON');

// Enable Write-Ahead Logging for better concurrency and durability
db.pragma('journal_mode = WAL');

module.exports = db;
