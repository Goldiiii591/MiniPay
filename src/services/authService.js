// src/services/authService.js
// WHY THIS EXISTS:
// This service isolates authentication logic (registration, password hashing, and login).
// Key principles:
// 1. Password security: We never store plaintext passwords. bcrypt adds a random salt and slow hashing
//    to protect against rainbow table attacks and brute force.
// 2. Atomic user creation: When a user signs up, their default wallet with 0 balance MUST be created
//    in the same database transaction. If wallet creation fails, the user record is rolled back,
//    ensuring we never have a user without a wallet.
// 3. JWT token generation: Provides a stateless session token that the client can send with subsequent requests.

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/connection');
const config = require('../config');

// Salt rounds for bcrypt (10 provides strong security with sub-100ms hashing time)
const BCRYPT_SALT_ROUNDS = 10;

class AuthService {
  /**
   * Registers a new user and provisions their wallet in an atomic transaction.
   */
  signup({ name, email, password }) {
    // Check if email already exists
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      const error = new Error('A user with this email already exists.');
      error.statusCode = 409; // Conflict
      throw error;
    }

    // Hash the password securely
    const passwordHash = bcrypt.hashSync(password, BCRYPT_SALT_ROUNDS);

    // Prepare statements for user and wallet creation
    const insertUserStmt = db.prepare(`
      INSERT INTO users (name, email, password_hash)
      VALUES (?, ?, ?)
    `);

    const insertWalletStmt = db.prepare(`
      INSERT INTO wallets (user_id, balance_in_paise)
      VALUES (?, 0)
    `);

    // Execute both in a single atomic transaction
    // WHY? If wallet creation fails for any reason, user creation is also rolled back.
    const createAccountTx = db.transaction((userName, userEmail, hash) => {
      const userResult = insertUserStmt.run(userName, userEmail, hash);
      const userId = userResult.lastInsertRowid;

      const walletResult = insertWalletStmt.run(userId);
      const walletId = walletResult.lastInsertRowid;

      return { userId, walletId };
    });

    const { userId, walletId } = createAccountTx(name, email, passwordHash);

    // Retrieve the newly created records (excluding password_hash for security)
    const user = db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(userId);
    const wallet = db.prepare('SELECT id, balance_in_paise, created_at FROM wallets WHERE id = ?').get(walletId);

    return {
      user,
      wallet
    };
  }

  /**
   * Validates user credentials and issues a signed JWT.
   */
  login({ email, password }) {
    // Look up user by email
    const user = db.prepare('SELECT id, name, email, password_hash FROM users WHERE email = ?').get(email);

    // Always use generic error message to avoid email enumeration attacks
    if (!user) {
      const error = new Error('Invalid email or password.');
      error.statusCode = 401; // Unauthorized
      throw error;
    }

    // Verify password against stored hash
    const isPasswordValid = bcrypt.compareSync(password, user.password_hash);
    if (!isPasswordValid) {
      const error = new Error('Invalid email or password.');
      error.statusCode = 401;
      throw error;
    }

    // Generate JWT token valid for 24 hours
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email
      },
      config.jwtSecret,
      { expiresIn: '24h' }
    );

    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
    };
  }
}

module.exports = new AuthService();
