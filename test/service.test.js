// test/service.test.js
// Unit / Service layer tests that run without opening network ports.
// Tests database transactions, ledger consistency, and double-entry invariants directly.

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'unit_test_secret_123';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/db/connection');
const { initSchema } = require('../src/db/schema');
const authService = require('../src/services/authService');
const walletService = require('../src/services/walletService');

before(() => {
  initSchema();
});

after(() => {
  if (db) db.close();
});

describe('Database & Service Integrity Tests', () => {
  let createdUser;
  let createdWallet;

  test('authService.signup creates user and wallet with 0 balance atomically', () => {
    const result = authService.signup({
      name: 'Bob Ledger',
      email: 'bob@example.com',
      password: 'mypassword123'
    });

    assert.ok(result.user.id);
    assert.equal(result.user.name, 'Bob Ledger');
    assert.equal(result.user.email, 'bob@example.com');
    assert.equal(result.wallet.balance_in_paise, 0);

    createdUser = result.user;
    createdWallet = result.wallet;
  });

  test('Foreign key constraints are enforced (cannot create wallet for non-existent user)', () => {
    assert.throws(() => {
      db.prepare('INSERT INTO wallets (user_id, balance_in_paise) VALUES (999999, 100)').run();
    }, /FOREIGN KEY constraint failed/);
  });

  test('Check constraint prevents negative wallet balance', () => {
    assert.throws(() => {
      db.prepare('UPDATE wallets SET balance_in_paise = -100 WHERE id = ?').run(createdWallet.id);
    }, /CHECK constraint failed/);
  });

  test('walletService.addMoney creates transaction and CREDIT ledger entry', () => {
    const result = walletService.addMoney({
      userId: createdUser.id,
      amountInPaise: 15000, // ₹150.00
      idempotencyKey: 'key_unit_test_1'
    });

    assert.equal(result.idempotentReplay, false);
    assert.equal(result.wallet.balance_in_paise, 15000);
    assert.equal(result.transaction.amount_in_paise, 15000);
    assert.equal(result.transaction.status, 'SUCCESS');
    assert.equal(result.ledgerEntry.type, 'CREDIT');
    assert.equal(result.ledgerEntry.amount_in_paise, 15000);

    // Verify double-entry ledger invariant:
    // Sum of CREDITs minus sum of DEBITs MUST match wallet balance!
    const ledgerSum = db.prepare(`
      SELECT 
        TOTAL(CASE WHEN type = 'CREDIT' THEN amount_in_paise ELSE 0 END) -
        TOTAL(CASE WHEN type = 'DEBIT' THEN amount_in_paise ELSE 0 END) AS calculated_balance
      FROM ledger_entries
      WHERE wallet_id = ?
    `).get(createdWallet.id);

    assert.equal(Number(ledgerSum.calculated_balance), 15000);
  });

  test('Idempotency prevents double crediting on retry', () => {
    const repeatResult = walletService.addMoney({
      userId: createdUser.id,
      amountInPaise: 15000,
      idempotencyKey: 'key_unit_test_1' // Re-sending same key
    });

    assert.equal(repeatResult.idempotentReplay, true);
    assert.equal(repeatResult.wallet.balance_in_paise, 15000); // Unchanged!

    // Ensure only 1 ledger entry exists
    const entries = db.prepare('SELECT * FROM ledger_entries WHERE wallet_id = ?').all(createdWallet.id);
    assert.equal(entries.length, 1);
  });
});
