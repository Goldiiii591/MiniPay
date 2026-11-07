// src/routes/transferRoutes.js
// WHY THIS EXISTS:
// Exposes the HTTP endpoints for transfers and transaction history.
// Endpoints defined here:
// 1. POST /transfer: Peer-to-peer money movement between two users.
//    - Protected by JWT authentication (`authenticateToken`).
//    - Requires the `Idempotency-Key` header.
//    - Body: { to_email, amount_in_paise }.
// 2. GET /transactions: Lists sent and received transfers for the logged-in user, newest first.
//
// Separating transport concerns (HTTP status codes, headers) from business logic (services)
// makes the system modular, maintainable, and easy to unit test.

const express = require('express');
const router = express.Router();
const transferService = require('../services/transferService');
const authenticateToken = require('../middleware/auth');

// All transfer and transaction endpoints require authentication
router.use(authenticateToken);

/**
 * POST /transfer
 * Transfers money from the authenticated user's wallet to another user's wallet.
 */
router.post('/transfer', (req, res, next) => {
  try {
    // Header check: Idempotency-Key is strictly required
    const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];

    const { to_email, amount_in_paise } = req.body || {};

    const result = transferService.transfer({
      senderUserId: req.user.userId,
      toEmail: to_email,
      amountInPaise: amount_in_paise,
      idempotencyKey
    });

    return res.status(200).json({
      success: true,
      message: result.message,
      idempotent_replay: result.idempotentReplay,
      data: {
        transaction: result.transaction,
        sender_balance_in_paise: result.senderWallet.balance_in_paise,
        sender_balance_inr: `₹${(result.senderWallet.balance_in_paise / 100).toFixed(2)}`,
        ledger_entries: result.ledgerEntries || []
      }
    });
  } catch (err) {
    // If the error was due to insufficient funds, the FAILED transaction was saved in DB
    if (err.transaction) {
      return res.status(err.statusCode || 400).json({
        success: false,
        error: err.message,
        idempotent_replay: Boolean(err.idempotentReplay),
        data: {
          transaction: err.transaction
        }
      });
    }
    next(err);
  }
});

/**
 * GET /transactions
 * Lists all sent and received transfers for the authenticated user, newest first.
 */
router.get('/transactions', (req, res, next) => {
  try {
    const transactions = transferService.getTransactions(req.user.userId);

    return res.status(200).json({
      success: true,
      transactions, // Convenience top-level access
      data: {
        transactions,
        count: transactions.length
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
