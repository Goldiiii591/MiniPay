// test/api.test.js
// Integration test suite for MiniPay API endpoints
// Uses Node.js built-in test runner (node:test) and assertions (node:assert)

// Use in-memory SQLite database for tests to prevent modifying production/dev database
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test_secret_key_12345';
process.env.PORT = '0'; // Ephemeral port

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const app = require('../src/app');
const db = require('../src/db/connection');
const { initSchema } = require('../src/db/schema');

let server;
let baseUrl;

before(async () => {
  // Initialize schema in test in-memory database
  initSchema();

  // Start HTTP server on an ephemeral port
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(() => {
  if (server) server.close();
  if (db) db.close();
});

describe('MiniPay API Integration Tests', () => {
  let authToken = '';
  let testUserId = null;
  let testWalletId = null;

  // --- 1. SIGNUP TESTS ---
  describe('POST /signup', () => {
    test('should reject signup with missing fields', async () => {
      const res = await fetch(`${baseUrl}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com' })
      });
      const data = await res.json();
      assert.equal(res.status, 400);
      assert.equal(data.success, false);
      assert.match(data.error, /Name is required/i);
    });

    test('should reject signup with invalid email format', async () => {
      const res = await fetch(`${baseUrl}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice', email: 'not-an-email', password: 'password123' })
      });
      const data = await res.json();
      assert.equal(res.status, 400);
      assert.equal(data.success, false);
      assert.match(data.error, /valid email/i);
    });

    test('should reject signup with short password (< 6 chars)', async () => {
      const res = await fetch(`${baseUrl}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice', email: 'alice@example.com', password: '123' })
      });
      const data = await res.json();
      assert.equal(res.status, 400);
      assert.equal(data.success, false);
      assert.match(data.error, /at least 6 characters/i);
    });

    test('should successfully sign up a user and create a wallet with 0 balance', async () => {
      const res = await fetch(`${baseUrl}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Alice Kumar',
          email: 'alice@example.com',
          password: 'secretPassword123'
        })
      });

      const data = await res.json();
      assert.equal(res.status, 201);
      assert.equal(data.success, true);
      assert.equal(data.data.user.name, 'Alice Kumar');
      assert.equal(data.data.user.email, 'alice@example.com');
      assert.equal(data.data.user.password_hash, undefined, 'password_hash should never be exposed');
      assert.equal(data.data.wallet.balance_in_paise, 0);

      testUserId = data.data.user.id;
      testWalletId = data.data.wallet.id;

      // Verify in DB that password hash is NOT plaintext
      const dbUser = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(testUserId);
      assert.notEqual(dbUser.password_hash, 'secretPassword123');
      assert.ok(dbUser.password_hash.startsWith('$2'));
    });

    test('should reject signup with an already registered email', async () => {
      const res = await fetch(`${baseUrl}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Alice Duplicate',
          email: 'alice@example.com',
          password: 'differentPassword'
        })
      });

      const data = await res.json();
      assert.equal(res.status, 409);
      assert.equal(data.success, false);
      assert.match(data.error, /already exists/i);
    });
  });

  // --- 2. LOGIN TESTS ---
  describe('POST /login', () => {
    test('should reject login with wrong password', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alice@example.com',
          password: 'wrongPassword'
        })
      });

      const data = await res.json();
      assert.equal(res.status, 401);
      assert.equal(data.success, false);
      assert.match(data.error, /invalid email or password/i);
    });

    test('should reject login for non-existent email', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'ghost@example.com',
          password: 'anyPassword'
        })
      });

      const data = await res.json();
      assert.equal(res.status, 401);
      assert.equal(data.success, false);
      assert.match(data.error, /invalid email or password/i);
    });

    test('should login successfully with correct credentials and return JWT', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alice@example.com',
          password: 'secretPassword123'
        })
      });

      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.success, true);
      assert.ok(data.data.token, 'Token should be returned');
      assert.equal(data.data.user.email, 'alice@example.com');

      // Store token for subsequent authenticated requests
      authToken = data.data.token;
    });
  });

  // --- 3. GET /wallet TESTS ---
  describe('GET /wallet', () => {
    test('should reject request without Authorization header', async () => {
      const res = await fetch(`${baseUrl}/wallet`);
      const data = await res.json();
      assert.equal(res.status, 401);
      assert.equal(data.success, false);
      assert.match(data.error, /authorization header is missing/i);
    });

    test('should reject request with malformed or invalid token', async () => {
      const res = await fetch(`${baseUrl}/wallet`, {
        headers: { Authorization: 'Bearer bad_token_12345' }
      });
      const data = await res.json();
      assert.equal(res.status, 401);
      assert.equal(data.success, false);
      assert.match(data.error, /invalid authentication token/i);
    });

    test('should return initial wallet balance of 0 paise for authenticated user', async () => {
      const res = await fetch(`${baseUrl}/wallet`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.success, true);
      assert.equal(data.data.balance_in_paise, 0);
      assert.equal(data.data.formatted_inr, '₹0.00');
      assert.equal(data.data.user_id, testUserId);
    });
  });

  // --- 4. POST /wallet/add-money TESTS ---
  describe('POST /wallet/add-money', () => {
    test('should reject request without token', async () => {
      const res = await fetch(`${baseUrl}/wallet/add-money`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_in_paise: 1000 })
      });
      assert.equal(res.status, 401);
    });

    test('should reject decimal / float amounts (strictly integer paise required)', async () => {
      const res = await fetch(`${baseUrl}/wallet/add-money`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ amount_in_paise: 99.99 })
      });
      const data = await res.json();
      assert.equal(res.status, 400);
      assert.equal(data.success, false);
      assert.match(data.error, /positive integer/i);
    });

    test('should reject zero or negative amounts', async () => {
      for (const invalidAmount of [0, -500, -1]) {
        const res = await fetch(`${baseUrl}/wallet/add-money`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({ amount_in_paise: invalidAmount })
        });
        const data = await res.json();
        assert.equal(res.status, 400);
        assert.equal(data.success, false);
      }
    });

    test('should reject non-numeric string amounts', async () => {
      const res = await fetch(`${baseUrl}/wallet/add-money`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ amount_in_paise: '500' })
      });
      const data = await res.json();
      assert.equal(res.status, 400);
      assert.equal(data.success, false);
    });

    test('should successfully add money (5000 paise = ₹50.00)', async () => {
      const res = await fetch(`${baseUrl}/wallet/add-money`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          amount_in_paise: 5000,
          idempotency_key: 'tx_test_key_001'
        })
      });

      const data = await res.json();
      assert.equal(res.status, 201);
      assert.equal(data.success, true);
      assert.equal(data.data.wallet.balance_in_paise, 5000);
      assert.equal(data.data.wallet.formatted_inr, '₹50.00');
      assert.equal(data.data.transaction.status, 'SUCCESS');
      assert.equal(data.data.transaction.amount_in_paise, 5000);
      assert.equal(data.data.transaction.from_wallet_id, null);
      assert.equal(data.data.transaction.to_wallet_id, testWalletId);
      assert.equal(data.data.ledger_entry.type, 'CREDIT');
      assert.equal(data.data.ledger_entry.amount_in_paise, 5000);

      // Verify in DB that ledger entry and transaction exist
      const txInDb = db.prepare('SELECT * FROM transactions WHERE idempotency_key = ?').get('tx_test_key_001');
      assert.ok(txInDb);
      assert.equal(txInDb.amount_in_paise, 5000);

      const ledgerInDb = db.prepare('SELECT * FROM ledger_entries WHERE transaction_id = ?').get(txInDb.id);
      assert.ok(ledgerInDb);
      assert.equal(ledgerInDb.type, 'CREDIT');
      assert.equal(ledgerInDb.amount_in_paise, 5000);
    });

    test('should verify GET /wallet reflects the updated balance', async () => {
      const res = await fetch(`${baseUrl}/wallet`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.data.balance_in_paise, 5000);
      assert.equal(data.data.formatted_inr, '₹50.00');
    });

    test('should be idempotent: retrying with identical idempotency_key must NOT double credit', async () => {
      const res = await fetch(`${baseUrl}/wallet/add-money`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          amount_in_paise: 5000,
          idempotency_key: 'tx_test_key_001' // SAME key!
        })
      });

      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.success, true);
      assert.equal(data.idempotent_replay, true);
      assert.match(data.message, /previously completed/i);

      // Balance MUST still be 5000, NOT 10000!
      assert.equal(data.data.wallet.balance_in_paise, 5000);

      // Verify ledger has only 1 entry for this key
      const ledgerCount = db.prepare(`
        SELECT COUNT(*) as count 
        FROM ledger_entries le 
        JOIN transactions t ON le.transaction_id = t.id 
        WHERE t.idempotency_key = ?
      `).get('tx_test_key_001');
      assert.equal(ledgerCount.count, 1);
    });

    test('should add money again with a different idempotency key and accumulate correctly', async () => {
      const res = await fetch(`${baseUrl}/wallet/add-money`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          amount_in_paise: 2500 // ₹25.00
        })
      });

      const data = await res.json();
      assert.equal(res.status, 201);
      // Previous 5000 + 2500 = 7500 paise
      assert.equal(data.data.wallet.balance_in_paise, 7500);
      assert.equal(data.data.wallet.formatted_inr, '₹75.00');
    });
  });
});
