# 💳 MiniPay

A simplified payment system backend built with **Node.js**, **Express**, and **SQLite (`better-sqlite3`)**.

---

## 📌 Architecture & Design Principles

### 1. Integer Currency (Paise, Never Floats)
In financial systems, floating-point numbers (IEEE 754 standard) are strictly forbidden because computers cannot represent decimal fractions precisely (e.g., `0.1 + 0.2 === 0.30000000000000004`). Over millions of transactions, rounding errors create audit mismatches and lost money.
- MiniPay stores all monetary values as **positive integers** representing **paise** ($1\text{ INR} = 100\text{ paise}$).
- For example, ₹50.00 is stored and processed as `5000`.
- Decimal and float inputs are rejected at the validation layer with `400 Bad Request`.

### 2. Double-Entry Ledger System
A wallet's `balance_in_paise` is a mutable cached aggregate. If a database corruption or dispute occurs, you cannot reconstruct how a balance was reached from a single column.
- MiniPay pairs every successful transaction with an immutable record in `ledger_entries` (`type: CREDIT` or `DEBIT`).
- **Audit Invariant**: The sum of all credits minus debits for any wallet always equals its current balance.

### 3. Idempotency Protection
Mobile apps and web clients frequently experience packet drops or timeouts. If a user clicks "Add Money" and their network hangs, their client will automatically retry.
- MiniPay supports an optional `idempotency_key` (via JSON body or `Idempotency-Key` header).
- If a request with a previously processed key arrives, MiniPay returns the original successful transaction without double-crediting the wallet.

### 4. Database Invariants & SQLite Pragmas
- `PRAGMA foreign_keys = ON;` is enforced on every connection (SQLite disables foreign keys by default).
- `PRAGMA journal_mode = WAL;` (Write-Ahead Logging) is enabled for high concurrency and crash resilience.
- `CHECK(balance_in_paise >= 0)` ensures balances cannot go negative at the database engine level.

---

## 📂 Project Structure

```text
minipay/
├── src/
│   ├── config.js              # Centralized environment configuration
│   ├── app.js                 # Express app definition & global middlewares
│   ├── server.js              # Bootstraps database schema and starts HTTP listener
│   ├── db/
│   │   ├── connection.js      # better-sqlite3 singleton with WAL mode & foreign keys
│   │   └── schema.js          # DDL migrations (users, wallets, transactions, ledger)
│   ├── middleware/
│   │   ├── auth.js            # JWT Bearer token authentication
│   │   ├── validate.js        # Strict input validation (paise integer checks, email format)
│   │   └── errorHandler.js    # Global error handler and SQLite error translation
│   ├── services/
│   │   ├── authService.js     # User registration, bcrypt password hashing, login & JWT
│   │   └── walletService.js   # Atomic transactions for balance updates & ledger logging
│   └── routes/
│       ├── authRoutes.js      # POST /signup, POST /login
│       └── walletRoutes.js    # GET /wallet, POST /wallet/add-money
├── test/
│   ├── service.test.js        # Unit & service-layer tests (runs isolated in-memory)
│   └── api.test.js            # Full integration HTTP test suite
├── .env.example               # Example configuration
├── .gitignore                 # Git ignore rules
├── package.json               # Scripts and dependencies
└── README.md                  # Documentation
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **npm**: v9.0.0 or higher

### Installation

1. Clone or open the repository:
   ```bash
   cd Minipay
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create your `.env` file (optional, defaults are included):
   ```bash
   cp .env.example .env
   ```

### Running the Server

- **Production / Standard Mode**:
  ```bash
  npm start
  ```

- **Development Mode** (auto-reloads on file changes using Node's built-in watcher):
  ```bash
  npm run dev
  ```

The server will initialize the SQLite tables automatically and listen on `http://localhost:3000`.

### Running Tests

MiniPay uses Node's native test runner (`node:test`):

- **Run Service & Integrity Tests** (runs in-memory without needing network ports):
  ```bash
  npm run test:unit
  ```

- **Run Full Integration Suite**:
  ```bash
  npm test
  ```

---

## 📡 API Reference

### 1. User Signup
Creates a new user, hashes their password with `bcrypt`, and automatically creates their wallet with an initial balance of `0` paise in a single atomic transaction.

- **URL**: `POST /signup`
- **Body**:
  ```json
  {
    "name": "Arjun Sharma",
    "email": "arjun@example.com",
    "password": "SecurePassword123"
  }
  ```
- **Response** (`201 Created`):
  ```json
  {
    "success": true,
    "message": "User registered successfully with an active wallet.",
    "data": {
      "user": {
        "id": 1,
        "name": "Arjun Sharma",
        "email": "arjun@example.com",
        "created_at": "2026-11-07 09:50:00"
      },
      "wallet": {
        "id": 1,
        "balance_in_paise": 0,
        "created_at": "2026-11-07 09:50:00"
      }
    }
  }
  ```

---

### 2. User Login
Verifies the user's password against the stored bcrypt hash and returns a signed JSON Web Token (JWT).

- **URL**: `POST /login`
- **Body**:
  ```json
  {
    "email": "arjun@example.com",
    "password": "SecurePassword123"
  }
  ```
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "Login successful.",
    "data": {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "user": {
        "id": 1,
        "name": "Arjun Sharma",
        "email": "arjun@example.com"
      }
    }
  }
  ```

---

### 3. Get Wallet Balance
Fetches the wallet balance for the authenticated user.

- **URL**: `GET /wallet`
- **Headers**:
  - `Authorization: Bearer <TOKEN>`
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": {
      "wallet_id": 1,
      "user_id": 1,
      "balance_in_paise": 5000,
      "formatted_inr": "₹50.00",
      "created_at": "2026-11-07 09:50:00"
    }
  }
  ```

---

### 4. Add Money to Wallet
Adds funds to the authenticated user's wallet. Atomically creates a `transactions` record, a `ledger_entries` record, and updates the `wallets` balance.

- **URL**: `POST /wallet/add-money`
- **Headers**:
  - `Authorization: Bearer <TOKEN>`
  - `Idempotency-Key: <OPTIONAL_UNIQUE_KEY>` (or in body)
- **Body**:
  ```json
  {
    "amount_in_paise": 5000,
    "idempotency_key": "topup_order_1001"
  }
  ```
- **Response** (`201 Created`):
  ```json
  {
    "success": true,
    "message": "Money added successfully.",
    "idempotent_replay": false,
    "data": {
      "wallet": {
        "id": 1,
        "balance_in_paise": 5000,
        "formatted_inr": "₹50.00"
      },
      "transaction": {
        "id": 1,
        "from_wallet_id": null,
        "to_wallet_id": 1,
        "amount_in_paise": 5000,
        "status": "SUCCESS",
        "idempotency_key": "topup_order_1001",
        "created_at": "2026-11-07 09:55:00"
      },
      "ledger_entry": {
        "id": 1,
        "transaction_id": 1,
        "wallet_id": 1,
        "type": "CREDIT",
        "amount_in_paise": 5000,
        "created_at": "2026-11-07 09:55:00"
      }
    }
  }
  ```
- **Idempotency Replay** (`200 OK` when repeating the same idempotency key):
  ```json
  {
    "success": true,
    "message": "Operation previously completed. Returning existing transaction.",
    "idempotent_replay": true,
    "data": {
      "wallet": {
        "id": 1,
        "balance_in_paise": 5000,
        "formatted_inr": "₹50.00"
      },
      "transaction": {
        "id": 1,
        "from_wallet_id": null,
        "to_wallet_id": 1,
        "amount_in_paise": 5000,
        "status": "SUCCESS",
        "idempotency_key": "topup_order_1001"
      },
      "ledger_entry": null
    }
  }
  ```

---

## 🧪 Quick Test Walkthrough with cURL

```bash
# 1. Sign up
curl -X POST http://localhost:3000/signup \
  -H "Content-Type: application/json" \
  -d '{"name":"Rahul","email":"rahul@test.com","password":"mypassword123"}'

# 2. Login (copy the returned token)
curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{"email":"rahul@test.com","password":"mypassword123"}'

# 3. Check Wallet (initial balance is 0)
curl -X GET http://localhost:3000/wallet \
  -H "Authorization: Bearer <PASTE_TOKEN_HERE>"

# 4. Add ₹100 (10000 paise)
curl -X POST http://localhost:3000/wallet/add-money \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <PASTE_TOKEN_HERE>" \
  -d '{"amount_in_paise": 10000, "idempotency_key": "topup_abc_123"}'

# 5. Check updated balance
curl -X GET http://localhost:3000/wallet \
  -H "Authorization: Bearer <PASTE_TOKEN_HERE>"
```

---

## 🛡️ Input Validation & Error Responses

All errors return consistent JSON responses:
```json
{
  "success": false,
  "error": "Error description here"
}
```

| HTTP Status | Reason |
|:---|:---|
| `400 Bad Request` | Missing/invalid fields, decimal or negative currency amounts |
| `401 Unauthorized` | Missing, expired, or invalid JWT token; invalid login credentials |
| `404 Not Found` | Route or requested wallet does not exist |
| `409 Conflict` | Duplicate email address or idempotency key collision |
| `500 Server Error` | Unexpected internal server error |
