// src/middleware/errorHandler.js
// WHY THIS EXISTS:
// A centralized error handling middleware catches any unhandled errors from route handlers
// or services, preventing the server from crashing or leaking sensitive stack traces to clients.
// It maps specific database errors (like unique constraint violations) to standard HTTP status codes.

function errorHandler(err, req, res, next) {
  // Handle invalid JSON body sent by client
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: 'Invalid JSON payload received in request body.'
    });
  }

  // Handle SQLite Unique constraint violations (e.g. duplicate email or idempotency_key)
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({
      success: false,
      error: 'A resource with the specified unique value already exists.'
    });
  }

  // Handle custom application errors with explicit status codes
  if (err.statusCode) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message
    });
  }

  console.error('Unhandled Server Error:', err);

  return res.status(500).json({
    success: false,
    error: 'Internal server error. Please try again later.'
  });
}

module.exports = errorHandler;
