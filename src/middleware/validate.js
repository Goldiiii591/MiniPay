// src/middleware/validate.js
// WHY THIS EXISTS:
// Input validation ensures data integrity before processing reaches business services or database layers.
// In payment systems:
// 1. Money MUST be verified as a positive integer in paise (e.g., ₹10.50 should be submitted as 1050 paise).
//    Decimals and floats cause precision loss and must be rejected immediately.
// 2. Email formats and required password lengths are checked to prevent malformed or insecure records.

// Simple standard regex for email format verification
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateSignup(req, res, next) {
  const { name, email, password } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Name is required and must be a non-empty string.'
    });
  }

  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    return res.status(400).json({
      success: false,
      error: 'A valid email address is required.'
    });
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({
      success: false,
      error: 'Password is required and must be at least 6 characters long.'
    });
  }

  // Normalize trimmed values
  req.body.name = name.trim();
  req.body.email = email.trim().toLowerCase();
  next();
}

function validateLogin(req, res, next) {
  const { email, password } = req.body;

  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    return res.status(400).json({
      success: false,
      error: 'A valid email address is required.'
    });
  }

  if (!password || typeof password !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Password is required.'
    });
  }

  req.body.email = email.trim().toLowerCase();
  next();
}

function validateAddMoney(req, res, next) {
  const { amount_in_paise } = req.body;

  // Strict check: must be a positive integer
  // Floats, strings, negative numbers, 0, NaN, and Infinity must be rejected
  if (
    typeof amount_in_paise !== 'number' ||
    !Number.isInteger(amount_in_paise) ||
    amount_in_paise <= 0
  ) {
    return res.status(400).json({
      success: false,
      error: 'Invalid amount. "amount_in_paise" must be a positive integer representing amount in paise (1 INR = 100 paise). Decimals/floats and negative values are strictly disallowed.'
    });
  }

  // Optional idempotency key in body or header
  const idempotencyKey =
    req.body.idempotency_key ||
    req.headers['idempotency-key'] ||
    req.headers['x-idempotency-key'];

  if (idempotencyKey !== undefined && idempotencyKey !== null) {
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'idempotency_key must be a non-empty string if provided.'
      });
    }
    req.idempotencyKey = idempotencyKey.trim();
  }

  next();
}

module.exports = {
  validateSignup,
  validateLogin,
  validateAddMoney
};
