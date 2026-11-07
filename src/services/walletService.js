// src/services/walletService.js
// WHY THIS EXISTS:
// This service manages all wallet and balance operations.
// Core financial principles implemented here:
// 1. ACID Transactions: Adding money must update the wallet balance, insert a transaction record,
//    and write a double-entry ledger record. If any step fails, everything rolls back.
// 2. Idempotency: In case of network retry or duplicate client calls, the unique idempotency key
//    ensures the user is never credited twice for the same intent.
// 3. Ledger auditability: Every change to a wallet balance is backed by an immutable ledger entry.
// 4. Integer arithmetic: All calculations are done in paise (integer).

const crypto = require('crypto');
const db = require('../db/connection');

class WalletService {
  /**
   * Retrieves the wallet belonging to a specific user.
   */
  getWalletByUserId(userId) {
    const wallet = db.prepare(`
      SELECT id, user_id, balance_in_paise, created_at 
      FROM wallets 
      WHERE user_id = ?
    `).get(userId);

    if (!wallet) {
      const error = new Error('Wallet not found for this user.');
      error.statusCode = 404;
      throw error;
    }

    return wallet;
  }

  /**
   * Adds money (in paise) to the user's wallet.
   * Atomically:
   * 1. Inserts a transaction record (status: SUCCESS).
   * 2. Inserts a CREDIT ledger entry.
   * 3. Increments the wallet's balance_in_paise.
   */
  addMoney({ userId, amountInPaise, idempotencyKey }) {
    // 1. Retrieve the user's wallet
    const wallet = this.getWalletByUserId(userId);

    // 2. Check Idempotency:
    // If the client provided an idempotency key, check if this operation already succeeded.
    if (idempotencyKey) {
      const existingTx = db.prepare(`
        SELECT id, from_wallet_id, to_wallet_id, amount_in_paise, status, idempotency_key, created_at
        FROM transactions
        WHERE idempotency_key = ?
      `).get(idempotencyKey);

      if (existingTx) {
        // Ensure this key belongs to the current user's wallet
        if (existingTx.to_wallet_id !== wallet.id) {
          const error = new Error('Idempotency key collision with a different transaction.');
          error.statusCode = 409;
          throw error;
        }

        // Return the existing successful transaction without adding money again!
        return {
          idempotentReplay: true,
          message: 'Operation previously completed. Returning existing transaction.',
          transaction: existingTx,
          wallet: {
            id: wallet.id,
            balance_in_paise: wallet.balance_in_paise
          }
        };
      }
    }

    // Use provided idempotency key or generate a unique random UUID
    const finalIdempotencyKey = idempotencyKey || `add_${wallet.id}_${crypto.randomUUID()}`;

    // Prepared statements for the atomic operation
    const insertTxStmt = db.prepare(`
      INSERT INTO transactions (from_wallet_id, to_wallet_id, amount_in_paise, status, idempotency_key)
      VALUES (NULL, ?, ?, 'SUCCESS', ?)
    `);

    const insertLedgerStmt = db.prepare(`
      INSERT INTO ledger_entries (transaction_id, wallet_id, type, amount_in_paise)
      VALUES (?, ?, 'CREDIT', ?)
    `);

    const updateWalletStmt = db.prepare(`
      UPDATE wallets
      SET balance_in_paise = balance_in_paise + ?
      WHERE id = ?
    `);

    // Execute atomic transaction
    // SQLite transaction ensures that either all 3 steps succeed, or none do.
    const addMoneyTx = db.transaction((walletId, amount, key) => {
      // Step A: Create transaction record (from_wallet_id is NULL for external top-ups)
      const txResult = insertTxStmt.run(walletId, amount, key);
      const transactionId = txResult.lastInsertRowid;

      // Step B: Create CREDIT ledger entry
      const ledgerResult = insertLedgerStmt.run(transactionId, walletId, amount);
      const ledgerEntryId = ledgerResult.lastInsertRowid;

      // Step C: Update wallet balance
      updateWalletStmt.run(amount, walletId);

      return { transactionId, ledgerEntryId };
    });

    const { transactionId, ledgerEntryId } = addMoneyTx(wallet.id, amountInPaise, finalIdempotencyKey);

    // Retrieve updated records for the response
    const updatedWallet = db.prepare('SELECT id, user_id, balance_in_paise FROM wallets WHERE id = ?').get(wallet.id);
    const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId);
    const ledgerEntry = db.prepare('SELECT * FROM ledger_entries WHERE id = ?').get(ledgerEntryId);

    return {
      idempotentReplay: false,
      message: 'Money added successfully.',
      transaction,
      ledgerEntry,
      wallet: {
        id: updatedWallet.id,
        balance_in_paise: updatedWallet.balance_in_paise
      }
    };
  }
}

module.exports = new WalletService();
