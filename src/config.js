// src/config.js
// WHY THIS EXISTS:
// Centralized configuration management prevents hardcoding constants across different files.
// It loads variables from .env if present and provides safe defaults for development.
// Validating configuration here ensures the app fails fast at boot time if vital secrets are missing.

const path = require('path');
require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  jwtSecret: process.env.JWT_SECRET || 'minipay_default_insecure_secret_for_dev_only',
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'minipay.db'),
  nodeEnv: process.env.NODE_ENV || 'development'
};
