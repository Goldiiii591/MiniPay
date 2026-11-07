// src/routes/walletRoutes.js
// WHY THIS EXISTS:
// Handles HTTP routing for wallet operations (checking balance, adding funds).
// All routes in this file require valid JWT authentication via `authenticateToken`.
// Separation of routes from business services allows easy unit testing and clean endpoint definitions.

const express = require('express');
const router = express.Router();
const walletService = require('../services/walletService');
const authenticateToken = require('../middleware/auth');
const { validateAddMoney } = require('../middleware/validate');

// All wallet endpoints require authentication
router.use(authenticateToken);

/**
 * GET /wallet
 * Retrieves the authenticated user's wallet and balance (in paise).
 */
router.get('/', (req, res, next) => {
  try {
    const wallet = walletService.getWalletByUserId(req.user.userId);

    return res.status(200).json({
      success: true,
      data: {
        wallet_id: wallet.id,
        user_id: wallet.user_id,
        balance_in_paise: wallet.balance_in_paise,
        // Informational helper: INR equivalent formatted as decimal string (paise / 100)
        formatted_inr: `₹${(wallet.balance_in_paise / 100).toFixed(2)}`,
        created_at: wallet.created_at
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /wallet/add-money
 * Adds funds (in integer paise) to the authenticated user's wallet.
 * Supports idempotency key (via body or header) to safely retry requests without double-crediting.
 */
router.post('/add-money', validateAddMoney, (req, res, next) => {
  try {
    const { amount_in_paise } = req.body;
    const idempotencyKey = req.idempotencyKey; // Populated by validateAddMoney if present

    const result = walletService.addMoney({
      userId: req.user.userId,
      amountInPaise: amount_in_paise,
      idempotencyKey
    });

    const statusCode = result.idempotentReplay ? 200 : 201;

    return res.status(statusCode).json({
      success: true,
      message: result.message,
      idempotent_replay: result.idempotentReplay,
      data: {
        wallet: {
          id: result.wallet.id,
          balance_in_paise: result.wallet.balance_in_paise,
          formatted_inr: `₹${(result.wallet.balance_in_paise / 100).toFixed(2)}`
        },
        transaction: result.transaction,
        ledger_entry: result.ledgerEntry || null
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
