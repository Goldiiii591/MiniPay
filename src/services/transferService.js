// src/services/transferService.js
// WHY THIS EXISTS:
// This service implements the core transfer domain logic for MiniPay.
// In fintech and payment engineering, transfers are among the most sensitive operations:
//
// 1. ATOMICITY (ACID):
//    Moving money between two parties involves multiple steps: deducting from sender, adding to recipient,
//    recording the transaction, and logging two ledger entries. If any step fails (e.g. process crash),
//    the entire transaction MUST roll back so money is never created or destroyed out of thin air.
//
// 2. IDEMPOTENCY:
//    Network interruptions often cause clients to retry requests. An Idempotency-Key ensures:
//    - Same user + same key + same payload => returns the original result without moving money again.
//    - Same key + different payload => returns 409 Conflict to prevent accidental key collisions.
//
// 3. FAILED ATTEMPTS PERSISTENCE:
//    When a user attempts a transfer with insufficient funds, no money must move, but the attempt
//    MUST be recorded with status 'FAILED'. Crucially, this record must NOT be placed inside a rolled-back
//    transaction block; otherwise, the rollback would erase the record, leaving no audit trail.
//
// 4. DOUBLE-ENTRY LEDGER:
//    Every transfer produces two balanced ledger records:
//    - Sender: DEBIT (outflow)
//    - Recipient: CREDIT (inflow)
//    The algebraic sum of ledger entries for any transfer is always zero (+amount - amount = 0).

const db = require('../db/connection');

class TransferService {
  /**
   * Executes a peer-to-peer money transfer.
   *
   * @param {Object} params
   * @param {number} params.senderUserId - ID of authenticated sender
   * @param {string} params.toEmail - Email address of the recipient
   * @param {number} params.amountInPaise - Amount in integer paise (> 0)
   * @param {string} params.idempotencyKey - Mandatory unique idempotency key
   */
  transfer({ senderUserId, toEmail, amountInPaise, idempotencyKey }) {
    // -------------------------------------------------------------
    // RULE 3 VALIDATIONS
    // -------------------------------------------------------------

    // 1. Validate Idempotency-Key
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      const err = new Error('Idempotency-Key header is required.');
      err.statusCode = 400;
      throw err;
    }
    const cleanIdempotencyKey = idempotencyKey.trim();

    // 2. Validate amount_in_paise: strictly positive integer
    if (
      typeof amountInPaise !== 'number' ||
      !Number.isInteger(amountInPaise) ||
      amountInPaise <= 0
    ) {
      const err = new Error(
        'amount_in_paise must be a positive integer in paise (1 INR = 100 paise). Decimals, floats, and amounts <= 0 are disallowed.'
      );
      err.statusCode = 400;
      throw err;
    }

    // 3. Validate recipient email input
    if (!toEmail || typeof toEmail !== 'string' || toEmail.trim().length === 0) {
      const err = new Error('Recipient email (to_email) is required.');
      err.statusCode = 400;
      throw err;
    }
    const cleanToEmail = toEmail.trim().toLowerCase();

    // 4. Retrieve sender user & wallet
    const senderUser = db.prepare('SELECT id, email FROM users WHERE id = ?').get(senderUserId);
    if (!senderUser) {
      const err = new Error('Sender user account not found.');
      err.statusCode = 404;
      throw err;
    }

    const senderWallet = db.prepare('SELECT id, user_id, balance_in_paise FROM wallets WHERE user_id = ?').get(senderUserId);
    if (!senderWallet) {
      const err = new Error('Sender wallet not found.');
      err.statusCode = 404;
      throw err;
    }

    // 5. Reject sending to yourself
    if (senderUser.email.toLowerCase() === cleanToEmail) {
      const err = new Error('Cannot transfer money to yourself.');
      err.statusCode = 400;
      throw err;
    }

    // 6. Retrieve recipient user & wallet
    const recipientUser = db.prepare('SELECT id, email FROM users WHERE email = ? COLLATE NOCASE').get(cleanToEmail);
    if (!recipientUser) {
      const err = new Error(`Recipient with email "${cleanToEmail}" not found.`);
      err.statusCode = 404;
      throw err;
    }

    const recipientWallet = db.prepare('SELECT id, user_id, balance_in_paise FROM wallets WHERE user_id = ?').get(recipientUser.id);
    if (!recipientWallet) {
      const err = new Error('Recipient wallet not found.');
      err.statusCode = 404;
      throw err;
    }

    // Extra safeguard: sender and recipient wallet must differ
    if (senderWallet.id === recipientWallet.id) {
      const err = new Error('Cannot transfer money to yourself.');
      err.statusCode = 400;
      throw err;
    }

    // -------------------------------------------------------------
    // RULE 2: IDEMPOTENCY KEY CHECK
    // -------------------------------------------------------------
    const existingTx = db.prepare(`
      SELECT id, from_wallet_id, to_wallet_id, amount_in_paise, status, idempotency_key, created_at
      FROM transactions
      WHERE idempotency_key = ?
    `).get(cleanIdempotencyKey);

    if (existingTx) {
      // Check if key was used by this user with the EXACT same body:
      // same sender, same recipient wallet, and same amount
      const isSameSender = existingTx.from_wallet_id === senderWallet.id;
      const isSameRecipient = existingTx.to_wallet_id === recipientWallet.id;
      const isSameAmount = existingTx.amount_in_paise === amountInPaise;

      if (isSameSender && isSameRecipient && isSameAmount) {
        // Return original result and do NOT move money again
        if (existingTx.status === 'SUCCESS') {
          return {
            idempotentReplay: true,
            status: 'SUCCESS',
            message: 'Transfer previously completed (idempotent replay).',
            transaction: existingTx,
            senderWallet: {
              id: senderWallet.id,
              balance_in_paise: senderWallet.balance_in_paise
            }
          };
        } else {
          // If the original attempt was FAILED, return the original failed result
          const err = new Error('Insufficient balance for transfer.');
          err.statusCode = 400;
          err.idempotentReplay = true;
          err.transaction = existingTx;
          throw err;
        }
      } else {
        // The key was used with a different body or different user => 409 Conflict
        const err = new Error('Idempotency key collision: This key was already used with a different request payload.');
        err.statusCode = 409;
        throw err;
      }
    }

    // -------------------------------------------------------------
    // RULE 4: INSUFFICIENT BALANCE CHECK (FAILED TRANSACTION)
    // -------------------------------------------------------------
    // If the sender's balance is insufficient, no money moves.
    // The attempt is recorded as a FAILED transaction.
    // Notice: We insert and commit this record outside any rolled-back block
    // so the record is permanently retained for auditing and idempotency!
    if (senderWallet.balance_in_paise < amountInPaise) {
      const insertFailedStmt = db.prepare(`
        INSERT INTO transactions (from_wallet_id, to_wallet_id, amount_in_paise, status, idempotency_key)
        VALUES (?, ?, ?, 'FAILED', ?)
      `);

      const result = insertFailedStmt.run(
        senderWallet.id,
        recipientWallet.id,
        amountInPaise,
        cleanIdempotencyKey
      );

      const failedTx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(result.lastInsertRowid);

      const err = new Error('Insufficient balance for transfer.');
      err.statusCode = 400;
      err.idempotentReplay = false;
      err.transaction = failedTx;
      throw err;
    }

    // -------------------------------------------------------------
    // RULE 1 & 5: ATOMIC MONEY MOVEMENT IN ONE DATABASE TRANSACTION
    // -------------------------------------------------------------
    // Prepared statements
    const insertTxStmt = db.prepare(`
      INSERT INTO transactions (from_wallet_id, to_wallet_id, amount_in_paise, status, idempotency_key)
      VALUES (?, ?, ?, 'SUCCESS', ?)
    `);

    const insertLedgerStmt = db.prepare(`
      INSERT INTO ledger_entries (transaction_id, wallet_id, type, amount_in_paise)
      VALUES (?, ?, ?, ?)
    `);

    const debitWalletStmt = db.prepare(`
      UPDATE wallets
      SET balance_in_paise = balance_in_paise - ?
      WHERE id = ?
    `);

    const creditWalletStmt = db.prepare(`
      UPDATE wallets
      SET balance_in_paise = balance_in_paise + ?
      WHERE id = ?
    `);

    // Execute atomic transfer inside one transaction
    const executeTransferTx = db.transaction((fromWalletId, toWalletId, amount, key) => {
      // Step 1: Record SUCCESS transaction
      const txResult = insertTxStmt.run(fromWalletId, toWalletId, amount, key);
      const transactionId = txResult.lastInsertRowid;

      // Step 2: Record DEBIT ledger entry for sender
      const debitLedger = insertLedgerStmt.run(transactionId, fromWalletId, 'DEBIT', amount);

      // Step 3: Record CREDIT ledger entry for recipient
      const creditLedger = insertLedgerStmt.run(transactionId, toWalletId, 'CREDIT', amount);

      // Step 4: Debit sender wallet balance
      debitWalletStmt.run(amount, fromWalletId);

      // Step 5: Credit recipient wallet balance
      creditWalletStmt.run(amount, toWalletId);

      return {
        transactionId,
        debitLedgerId: debitLedger.lastInsertRowid,
        creditLedgerId: creditLedger.lastInsertRowid
      };
    });

    const { transactionId, debitLedgerId, creditLedgerId } = executeTransferTx(
      senderWallet.id,
      recipientWallet.id,
      amountInPaise,
      cleanIdempotencyKey
    );

    // Retrieve fresh updated state
    const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId);
    const updatedSenderWallet = db.prepare('SELECT id, balance_in_paise FROM wallets WHERE id = ?').get(senderWallet.id);
    const debitLedger = db.prepare('SELECT * FROM ledger_entries WHERE id = ?').get(debitLedgerId);
    const creditLedger = db.prepare('SELECT * FROM ledger_entries WHERE id = ?').get(creditLedgerId);

    return {
      idempotentReplay: false,
      status: 'SUCCESS',
      message: 'Transfer completed successfully.',
      transaction,
      senderWallet: updatedSenderWallet,
      ledgerEntries: [debitLedger, creditLedger]
    };
  }

  /**
   * Retrieves sent and received transfers for an authenticated user, newest first.
   *
   * @param {number} userId - ID of the authenticated user
   */
  getTransactions(userId) {
    const wallet = db.prepare('SELECT id FROM wallets WHERE user_id = ?').get(userId);
    if (!wallet) {
      const err = new Error('Wallet not found.');
      err.statusCode = 404;
      throw err;
    }

    // List transfers where user is sender or receiver (from_wallet_id IS NOT NULL),
    // ordered newest first (created_at DESC, id DESC).
    const rows = db.prepare(`
      SELECT 
        t.id,
        t.from_wallet_id,
        t.to_wallet_id,
        t.amount_in_paise,
        t.status,
        t.idempotency_key,
        t.created_at,
        sender_u.email AS from_email,
        receiver_u.email AS to_email,
        CASE 
          WHEN t.from_wallet_id = ? THEN 'SENT'
          ELSE 'RECEIVED'
        END AS direction
      FROM transactions t
      JOIN wallets sender_w ON t.from_wallet_id = sender_w.id
      JOIN users sender_u ON sender_w.user_id = sender_u.id
      JOIN wallets receiver_w ON t.to_wallet_id = receiver_w.id
      JOIN users receiver_u ON receiver_w.user_id = receiver_u.id
      WHERE (t.from_wallet_id = ? OR t.to_wallet_id = ?)
      ORDER BY t.created_at DESC, t.id DESC
    `).all(wallet.id, wallet.id, wallet.id);

    return rows.map((row) => ({
      ...row,
      formatted_inr: `₹${(row.amount_in_paise / 100).toFixed(2)}`
    }));
  }
}

module.exports = new TransferService();
