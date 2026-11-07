// src/middleware/auth.js
// WHY THIS EXISTS:
// In a payment application, sensitive endpoints (like viewing balance or adding money)
// must be strictly restricted to authenticated users.
// This middleware verifies the stateless JWT (JSON Web Token) from the "Authorization: Bearer <token>" header,
// extracts the authenticated user's ID, and attaches it to `req.user`.

const jwt = require('jsonwebtoken');
const config = require('../config');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader) {
    return res.status(401).json({
      success: false,
      error: 'Authorization header is missing. Expected format: "Authorization: Bearer <token>"'
    });
  }

  // Header format: "Bearer <token>"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({
      success: false,
      error: 'Invalid Authorization header format. Expected format: "Authorization: Bearer <token>"'
    });
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    // Attach decoded user info (userId, email) to the request object
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Authentication token has expired. Please log in again.'
      });
    }
    return res.status(401).json({
      success: false,
      error: 'Invalid authentication token.'
    });
  }
}

module.exports = authenticateToken;
