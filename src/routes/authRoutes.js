// src/routes/authRoutes.js
// WHY THIS EXISTS:
// Handles HTTP routing for user onboarding and authentication.
// It maps HTTP endpoints to input validators and authService methods,
// ensuring separation of transport concerns (HTTP request/response) from business logic.

const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const { validateSignup, validateLogin } = require('../middleware/validate');

/**
 * POST /signup
 * Creates a new user account and initializes a wallet with 0 balance.
 */
router.post('/signup', validateSignup, (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const result = authService.signup({ name, email, password });
    
    return res.status(201).json({
      success: true,
      message: 'User registered successfully with an active wallet.',
      data: result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /login
 * Authenticates user credentials and returns a JWT token.
 */
router.post('/login', validateLogin, (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = authService.login({ email, password });

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      data: result
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
