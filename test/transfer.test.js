// test/transfer.test.js
// Integration test suite for MiniPay Transfers and Transactions API
// Tests all Day 2 rules:
// 1. Whole money movement inside ONE database transaction
// 2. Idempotency handling (same key + same body => no double movement; different body => 409)
// 3. Validation rejections (self transfer, unknown recipient, float amount, amount <= 0, missing key)
// 4. Insufficient balance: no money moves, attempt saved as FAILED, rollback does not erase record
// 5. Success: debit sender, credit receiver, two ledger entries (DEBIT/CREDIT), transaction marked SUCCESS
// 6. Double-entry ledger audit: ledger entries for one transfer sum to zero
// 7. GET /transactions: lists sent and received transfers, newest first

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'transfer_test_secret_98765';
process.env.PORT = '0';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const app = require('../src/app');
const db = require('../src/db/connection');
const { initSchema } = require('../src/db/schema');

let server;
let baseUrl;

// Tokens and user IDs
let aliceToken = '';
let aliceEmail = 'alice.transfer@test.com';
let aliceWalletId;

let bobToken = '';
let bobEmail = 'bob.transfer@test.com';
let bobWalletId;

let charlieEmail = 'charlie.transfer@test.com';
let charlieToken = '';

before(async () => {
  initSchema();

  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

  // Setup User 1: Alice
  const aliceSignup = await fetch(`${baseUrl}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Alice', email: aliceEmail, password: 'password123' })
  });
  const aliceData = await aliceSignup.json();
  aliceWalletId = aliceData.data.wallet.id;

  const aliceLogin = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: aliceEmail, password: 'password123' })
  });
  const aliceLoginData = await aliceLogin.json();
  aliceToken = aliceLoginData.data.token;

  // Fund Alice's wallet with 10,000 paise (₹100.00)
  await fetch(`${baseUrl}/wallet/add-money`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aliceToken}`
    },
    body: JSON.stringify({ amount_in_paise: 10000 })
  });

  // Setup User 2: Bob (starts with 0 balance)
  const bobSignup = await fetch(`${baseUrl}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Bob', email: bobEmail, password: 'password123' })
  });
  const bobData = await bobSignup.json();
  bobWalletId = bobData.data.wallet.id;

  const bobLogin = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: bobEmail, password: 'password123' })
  });
  const bobLoginData = await bobLogin.json();
  bobToken = bobLoginData.data.token;

  // Setup User 3: Charlie (for collision test)
  const charlieSignup = await fetch(`${baseUrl}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Charlie', email: charlieEmail, password: 'password123' })
  });
  const charlieData = await charlieSignup.json();
  const charlieLogin = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: charlieEmail, password: 'password123' })
  });
  const charlieLoginData = await charlieLogin.json();
  charlieToken = charlieLoginData.data.token;
});

after(() => {
  if (server) server.close();
  if (db) db.close();
});

describe('POST /transfer & GET /transactions Tests', () => {

  // --- RULE 3: VALIDATION CHECKS ---
  describe('Rule 3: Input Validation and Clear Error Rejections', () => {
    test('should reject request without Idempotency-Key header', async () => {
      const res = await fetch(`${baseUrl}/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`
        },
        body: JSON.stringify({ to_email: bobEmail, amount_in_paise: 1000 })
      });
      const data = await res.json();
      assert.equal(res.status, 400);
      assert.equal(data.success, false);
      assert.match(data.error, /Idempotency-Key header is required/i);
    });

    test('should reject transferring to yourself', async () => {
      const res = await fetch(`${baseUrl}/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
          'Idempotency-Key': 'self-transfer-1'
        },
        body: JSON.stringify({ to_email: aliceEmail, amount_in_paise: 1000 })
      });
      const data = await res.json();
      assert.equal(res.status, 400);
      assert.equal(data.success, false);
      assert.match(data.error, /cannot transfer money to yourself/i);
    });

    test('should reject unknown recipient email', async () => {
      const res = await fetch(`${baseUrl}/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
          'Idempotency-Key': 'unknown-user-key'
        },
        body: JSON.stringify({ to_email: 'ghost_recipient@example.com', amount_in_paise: 500 })
      });
      const data = await res.json();
      assert.equal(res.status, 404);
      assert.equal(data.success, false);
      assert.match(data.error, /not found/i);
    });

    test('should reject non-integer amount (float/decimal)', async () => {
      const res = await fetch(`${baseUrl}/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
          'Idempotency-Key': 'float-amount-key'
        },
        body: JSON.stringify({ to_email: bobEmail, amount_in_paise: 49.99 })
      });
      const data = await res.json();
      assert.equal(res.status, 400);
      assert.equal(data.success, false);
      assert.match(data.error, /positive integer/i);
    });

    test('should reject amount <= 0', async () => {
      for (const amount of [0, -100, -1]) {
        const res = await fetch(`${baseUrl}/transfer`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${aliceToken}`,
            'Idempotency-Key': `negative-amount-${amount}`
          },
          body: JSON.stringify({ to_email: bobEmail, amount_in_paise: amount })
        });
        const data = await res.json();
        assert.equal(res.status, 400);
        assert.equal(data.success, false);
      }
    });
  });

  // --- RULE 4: INSUFFICIENT BALANCE & FAILED TRANSACTION PERSISTENCE ---
  describe('Rule 4: Insufficient Balance Handling', () => {
    test('a failed transfer leaves both balances unchanged and saves a FAILED transaction record', async () => {
      // Alice has 10,000 paise. She tries to send 50,000 paise.
      const res = await fetch(`${baseUrl}/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
          'Idempotency-Key': 'key-insufficient-funds-01'
        },
        body: JSON.stringify({ to_email: bobEmail, amount_in_paise: 50000 })
      });

      const data = await res.json();
      assert.equal(res.status, 400);
      assert.equal(data.success, false);
      assert.match(data.error, /insufficient balance/i);

      // Verify Alice's balance is UNCHANGED (still 10,000 paise)
      const aliceWallet = db.prepare('SELECT balance_in_paise FROM wallets WHERE id = ?').get(aliceWalletId);
      assert.equal(aliceWallet.balance_in_paise, 10000);

      // Verify Bob's balance is UNCHANGED (still 0 paise)
      const bobWallet = db.prepare('SELECT balance_in_paise FROM wallets WHERE id = ?').get(bobWalletId);
      assert.equal(bobWallet.balance_in_paise, 0);

      // Verify the transaction was saved with status FAILED (rollback did NOT erase it)
      const failedTx = db.prepare('SELECT * FROM transactions WHERE idempotency_key = ?').get('key-insufficient-funds-01');
      assert.ok(failedTx, 'FAILED transaction must be persisted in DB');
      assert.equal(failedTx.status, 'FAILED');
      assert.equal(failedTx.amount_in_paise, 50000);
      assert.equal(failedTx.from_wallet_id, aliceWalletId);
      assert.equal(failedTx.to_wallet_id, bobWalletId);

      // Verify NO ledger entries exist for this failed transaction
      const ledgerCount = db.prepare('SELECT COUNT(*) as count FROM ledger_entries WHERE transaction_id = ?').get(failedTx.id);
      assert.equal(ledgerCount.count, 0, 'No ledger entries must exist for failed transfers');
    });

    test('retrying a previously failed transfer with the same idempotency key returns the original failed result and does not move money', async () => {
      const res = await fetch(`${baseUrl}/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
          'Idempotency-Key': 'key-insufficient-funds-01' // SAME key!
        },
        body: JSON.stringify({ to_email: bobEmail, amount_in_paise: 50000 })
      });

      const data = await res.json();
      assert.equal(res.status, 400);
      assert.equal(data.success, false);
      assert.equal(data.idempotent_replay, true);

      // Balances remain unchanged
      const aliceWallet = db.prepare('SELECT balance_in_paise FROM wallets WHERE id = ?').get(aliceWalletId);
      assert.equal(aliceWallet.balance_in_paise, 10000);
    });
  });

  // --- RULE 1 & 5: SUCCESSFUL TRANSFER & DOUBLE-ENTRY LEDGER ---
  describe('Rule 1, 5: Successful Transfer and Double-Entry Ledger', () => {
    let transferTxId;

    test('successfully transfers 3,000 paise (₹30.00) from Alice to Bob in one transaction', async () => {
      const res = await fetch(`${baseUrl}/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
          'Idempotency-Key': 'tx-success-001'
        },
        body: JSON.stringify({ to_email: bobEmail, amount_in_paise: 3000 })
      });

      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.success, true);
      assert.equal(data.data.transaction.status, 'SUCCESS');
      assert.equal(data.data.transaction.amount_in_paise, 3000);
      assert.equal(data.data.sender_balance_in_paise, 7000); // 10,000 - 3,000 = 7,000

      transferTxId = data.data.transaction.id;

      // Verify Alice was debited 3,000 paise
      const aliceWallet = db.prepare('SELECT balance_in_paise FROM wallets WHERE id = ?').get(aliceWalletId);
      assert.equal(aliceWallet.balance_in_paise, 7000);

      // Verify Bob was credited 3,000 paise
      const bobWallet = db.prepare('SELECT balance_in_paise FROM wallets WHERE id = ?').get(bobWalletId);
      assert.equal(bobWallet.balance_in_paise, 3000);

      // Verify two ledger entries exist: one DEBIT, one CREDIT
      const entries = db.prepare('SELECT * FROM ledger_entries WHERE transaction_id = ? ORDER BY id ASC').all(transferTxId);
      assert.equal(entries.length, 2, 'Exactly two ledger entries must be created for a transfer');

      const debitEntry = entries.find((e) => e.type === 'DEBIT');
      const creditEntry = entries.find((e) => e.type === 'CREDIT');

      assert.ok(debitEntry, 'DEBIT entry must exist');
      assert.equal(debitEntry.wallet_id, aliceWalletId);
      assert.equal(debitEntry.amount_in_paise, 3000);

      assert.ok(creditEntry, 'CREDIT entry must exist');
      assert.equal(creditEntry.wallet_id, bobWalletId);
      assert.equal(creditEntry.amount_in_paise, 3000);
    });

    test('the ledger entries for one transfer sum to zero', async () => {
      // In double-entry accounting: CREDIT (+amount) + DEBIT (-amount) MUST sum to 0
      const sumResult = db.prepare(`
        SELECT 
          SUM(CASE WHEN type = 'CREDIT' THEN amount_in_paise ELSE -amount_in_paise END) AS net_sum
        FROM ledger_entries
        WHERE transaction_id = ?
      `).get(transferTxId);

      assert.equal(sumResult.net_sum, 0, 'Ledger entries for a transfer must sum algebraically to zero');
    });
  });

  // --- RULE 2: IDEMPOTENCY KEY HANDLING ---
  describe('Rule 2: Idempotency Key Semantics', () => {
    test('the same key sent twice moves money only once', async () => {
      // Prior balance: Alice has 7,000, Bob has 3,000
      // Send again with the SAME key 'tx-success-001' and SAME body
      const res = await fetch(`${baseUrl}/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
          'Idempotency-Key': 'tx-success-001'
        },
        body: JSON.stringify({ to_email: bobEmail, amount_in_paise: 3000 })
      });

      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.success, true);
      assert.equal(data.idempotent_replay, true);
      assert.match(data.message, /previously completed/i);

      // CRITICAL CHECK: Balances MUST remain unchanged!
      const aliceWallet = db.prepare('SELECT balance_in_paise FROM wallets WHERE id = ?').get(aliceWalletId);
      assert.equal(aliceWallet.balance_in_paise, 7000, "Alice's balance must NOT be debited again");

      const bobWallet = db.prepare('SELECT balance_in_paise FROM wallets WHERE id = ?').get(bobWalletId);
      assert.equal(bobWallet.balance_in_paise, 3000, "Bob's balance must NOT be credited again");

      // Verify transactions table still has only ONE transaction with this key
      const txCount = db.prepare('SELECT COUNT(*) as count FROM transactions WHERE idempotency_key = ?').get('tx-success-001');
      assert.equal(txCount.count, 1, 'Only one transaction record should exist');
    });

    test('reusing an existing idempotency key with a DIFFERENT body returns 409 Conflict', async () => {
      // Reusing 'tx-success-001' but with a different amount (e.g. 1,000 instead of 3,000)
      const resAmountMismatch = await fetch(`${baseUrl}/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
          'Idempotency-Key': 'tx-success-001'
        },
        body: JSON.stringify({ to_email: bobEmail, amount_in_paise: 1000 })
      });

      const dataAmountMismatch = await resAmountMismatch.json();
      assert.equal(resAmountMismatch.status, 409);
      assert.equal(dataAmountMismatch.success, false);
      assert.match(dataAmountMismatch.error, /collision/i);

      // Reusing 'tx-success-001' with a different recipient (Charlie instead of Bob)
      const resRecipientMismatch = await fetch(`${baseUrl}/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
          'Idempotency-Key': 'tx-success-001'
        },
        body: JSON.stringify({ to_email: charlieEmail, amount_in_paise: 3000 })
      });

      const dataRecipientMismatch = await resRecipientMismatch.json();
      assert.equal(resRecipientMismatch.status, 409);
      assert.equal(dataRecipientMismatch.success, false);
      assert.match(dataRecipientMismatch.error, /collision/i);
    });

    test('a different user attempting to reuse another user idempotency key returns 409 Conflict', async () => {
      // Bob tries to use Alice's idempotency key
      const res = await fetch(`${baseUrl}/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bobToken}`,
          'Idempotency-Key': 'tx-success-001'
        },
        body: JSON.stringify({ to_email: charlieEmail, amount_in_paise: 1000 })
      });

      const data = await res.json();
      assert.equal(res.status, 409);
      assert.equal(data.success, false);
      assert.match(data.error, /collision/i);
    });
  });

  // --- GET /transactions TESTS ---
  describe('GET /transactions: List Sent and Received Transfers', () => {
    before(async () => {
      // Execute a second transfer: Bob transfers 1,000 paise to Charlie
      await fetch(`${baseUrl}/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bobToken}`,
          'Idempotency-Key': 'tx-bob-to-charlie-01'
        },
        body: JSON.stringify({ to_email: charlieEmail, amount_in_paise: 1000 })
      });
    });

    test('should reject GET /transactions without auth token', async () => {
      const res = await fetch(`${baseUrl}/transactions`);
      assert.equal(res.status, 401);
    });

    test('Alice should see her sent transfer to Bob', async () => {
      const res = await fetch(`${baseUrl}/transactions`, {
        headers: { Authorization: `Bearer ${aliceToken}` }
      });

      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.success, true);
      assert.ok(Array.isArray(data.transactions));
      
      // Alice has 2 transactions: 1 failed (50,000 paise) and 1 success (3,000 paise)
      assert.equal(data.transactions.length, 2);
      assert.equal(data.transactions[0].direction, 'SENT');
      assert.equal(data.transactions[0].from_email, aliceEmail);
    });

    test('Bob should see his received transfer from Alice and sent transfer to Charlie, newest first', async () => {
      const res = await fetch(`${baseUrl}/transactions`, {
        headers: { Authorization: `Bearer ${bobToken}` }
      });

      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.success, true);
      assert.ok(Array.isArray(data.transactions));
      assert.equal(data.transactions.length, 3); // 1 failed sent to Bob, 1 success received from Alice, 1 success sent to Charlie

      // Newest should be sent to Charlie
      const newest = data.transactions[0];
      assert.equal(newest.direction, 'SENT');
      assert.equal(newest.to_email, charlieEmail);
      assert.equal(newest.amount_in_paise, 1000);

      // One of the older ones should be received from Alice
      const received = data.transactions.find((tx) => tx.direction === 'RECEIVED' && tx.status === 'SUCCESS');
      assert.ok(received);
      assert.equal(received.from_email, aliceEmail);
      assert.equal(received.amount_in_paise, 3000);
    });
  });
});
