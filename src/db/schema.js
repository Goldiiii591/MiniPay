// src/db/schema.js
// WHY THIS EXISTS:
// This file initializes the database schema idempotently (CREATE TABLE IF NOT EXISTS).
// In financial applications, database-level constraints (UNIQUE, FOREIGN KEY, CHECK) act
// as the final line of defense against corrupted balances, negative money, or orphan records.

const db = require('./connection');

function initSchema() {
  db.exec(`
    -- 1. USERS TABLE
    -- Stores user credentials and authentication details.
    -- Email is UNIQUE to ensure identity uniqueness.
    -- Password is stored strictly as a salted bcrypt hash, never plaintext.
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. WALLETS TABLE
    -- Stores user wallets with balance in the smallest currency unit (paise).
    -- WHY PAISE AS INTEGER?
    -- Floating-point numbers in computers suffer from IEEE-754 precision issues (e.g. 0.1 + 0.2 != 0.3).
    -- In financial accounting, lost fractions cause ledger imbalances.
    -- Storing integer paise (1 INR = 100 paise) guarantees 100% mathematical precision.
    -- CHECK(balance_in_paise >= 0) guarantees the balance can NEVER drop below zero at the DB level.
    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      balance_in_paise INTEGER NOT NULL DEFAULT 0 CHECK(balance_in_paise >= 0),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- 3. TRANSACTIONS TABLE
    -- High-level representation of an operation (e.g. Add Money, Transfer).
    -- from_wallet_id is NULL when money is added from an external source (bank/card).
    -- idempotency_key prevents duplicate operations when clients retry on network hiccups.
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_wallet_id INTEGER,
      to_wallet_id INTEGER NOT NULL,
      amount_in_paise INTEGER NOT NULL CHECK(amount_in_paise > 0),
      status TEXT NOT NULL CHECK(status IN ('PENDING', 'SUCCESS', 'FAILED')),
      idempotency_key TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (from_wallet_id) REFERENCES wallets(id),
      FOREIGN KEY (to_wallet_id) REFERENCES wallets(id)
    );

    -- 4. LEDGER ENTRIES TABLE
    -- WHY THIS EXISTS:
    -- Double-entry accounting principles: A wallet balance is a mutable summary, but the ledger
    -- is an immutable audit log of every CREDIT and DEBIT.
    -- If there is ever a dispute or audit, the sum of CREDITs minus DEBITs must strictly equal
    -- the current wallet balance.
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      wallet_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('DEBIT', 'CREDIT')),
      amount_in_paise INTEGER NOT NULL CHECK(amount_in_paise > 0),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
      FOREIGN KEY (wallet_id) REFERENCES wallets(id)
    );

    -- INDEXES
    -- Speeds up frequent lookups: wallet by user, transactions by idempotency key or wallet,
    -- and ledger entries by wallet.
    CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_idempotency ON transactions(idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_transactions_to_wallet ON transactions(to_wallet_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_from_wallet ON transactions(from_wallet_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_wallet ON ledger_entries(wallet_id);
  `);
}

module.exports = {
  initSchema
};
