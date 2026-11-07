# 💳 MiniPay

A simplified payment system backend and web UI built with **Node.js**, **Express**, **SQLite (`better-sqlite3`)**, and **vanilla HTML/CSS/JavaScript**.

---

## 🖥️ Web UI (Frontend)

MiniPay comes with a clean, responsive single-page frontend served directly by Express from the `public/` directory (no external frontend frameworks required).

### How to Open the Web Page
1. Start the MiniPay server:
   ```bash
   npm start
   # or with auto-reload:
   npm run dev
   ```
2. Open your web browser and navigate to:
   ```text
   http://localhost:3000
   ```

### Frontend Capabilities
- **Authentication**: Seamless tabs to sign up (with automatic wallet provisioning) or log in. JWT tokens are stored securely in `localStorage`.
- **Live Balance**: Displays wallet balance formatted in Rupees (e.g. `₹50.00`) alongside the exact underlying integer paise (`5,000 paise`).
- **Add Money**: Accepts amount in Rupees (with quick chips like `+₹100`, `+₹500`), provides a live preview, and converts to integer paise before sending to `/wallet/add-money`.
- **Send Money with Idempotency**:
  - Automatically generates an `Idempotency-Key` using `crypto.randomUUID()` once per form submission.
  - If a submission fails (e.g., insufficient funds or network glitch), the UI preserves the exact same key and provides a **"Retry Transfer with Same Key"** button, preventing duplicate debits.
  - If the user changes the recipient email or amount, a new key is generated for the new intent.
- **Transfer History**: Automatically refreshed table showing:
  - Direction (`📤 Sent` vs `📥 Received`)
  - Counterparty email (`To: ...` / `From: ...`)
  - Amount in Rupees (`- ₹30.00` / `+ ₹30.00`)
  - Status badges (`✓ SUCCESS`, `✗ FAILED`)
  - Formatted timestamp & idempotency key reference

---

## 📌 Architecture & Financial Engineering Principles

### 1. Integer Currency (Paise, Never Floats)
In financial systems, floating-point numbers (IEEE 754 standard) are strictly forbidden because computers cannot represent decimal fractions precisely (e.g., `0.1 + 0.2 === 0.30000000000000004`). Over millions of transactions, rounding errors create audit mismatches and lost money.
- MiniPay stores all monetary values as **positive integers** representing **paise** ($1\text{ INR} = 100\text{ paise}$).
- For example, ₹50.00 is stored and processed as `5000`.
- The frontend UI converts user inputs in decimal Rupees into integer paise (`Math.round(rupees * 100)`) before sending payloads to the API.
- Decimal and float inputs are rejected at the backend validation layer with `400 Bad Request`.

### 2. Double-Entry Ledger System
A wallet's `balance_in_paise` is a mutable cached aggregate. If a dispute or database corruption occurs, you cannot reconstruct how a balance was reached from a single column.
- MiniPay pairs every successful transaction with immutable records in `ledger_entries` (`type: CREDIT` or `DEBIT`).
- **Transfer Zero-Sum Invariant**: For every peer-to-peer transfer, exactly two ledger entries are written:
  - Sender: `DEBIT` (-amount)
  - Receiver: `CREDIT` (+amount)
  - The algebraic sum of ledger entries for any transfer is always zero ($\text{CREDIT} - \text{DEBIT} = 0$).

### 3. Transfer Rules & Atomicity ("WHY each rule exists")
- **Rule 1: Whole money movement in ONE database transaction**
  - *Why*: Deducting from sender, crediting receiver, recording transaction status, and inserting two ledger entries must all happen atomically. If a server crash occurs midway, SQLite transaction rollback guarantees that money is never created or destroyed out of thin air.
- **Rule 2: Idempotency Key Semantics**
  - *Why*: Network timeouts or duplicate clicks can re-send transfer requests. Mandating an `Idempotency-Key` header ensures:
    - Same user + same key + same payload $\rightarrow$ returns original result without moving money again.
    - Same key + different payload $\rightarrow$ returns `409 Conflict` to prevent accidental duplicate key reuse.
- **Rule 3: Strict Input Validation & Rejections**
  - *Why*: Prevents sending money to yourself, transfers to non-existent users, non-integer/float values, amounts $\le 0$, or requests without an `Idempotency-Key`.
- **Rule 4: Insufficient Balance & FAILED Record Persistence**
  - *Why*: If a sender does not have enough balance, no money moves. However, the attempt MUST be permanently saved as a `FAILED` transaction for security, audit, and idempotency tracking. This record is committed outside any rolled-back block so the rollback does not erase the audit trail.
- **Rule 5: Success Execution**
  - *Why*: On sufficient balance, the sender is debited, receiver is credited, two balanced ledger entries (`DEBIT`/`CREDIT`) are written, and the transaction is marked `SUCCESS`.

### 4. Database Invariants & SQLite Pragmas
- `PRAGMA foreign_keys = ON;` is enforced on every connection (SQLite disables foreign keys by default).
- `PRAGMA journal_mode = WAL;` (Write-Ahead Logging) is enabled for high concurrency and crash resilience.
- `CHECK(balance_in_paise >= 0)` ensures balances cannot go negative at the database engine level.

---

## 📂 Project Structure

```text
minipay/
├── public/                    # Frontend UI (Vanilla HTML/CSS/JS)
│   ├── index.html             # Single-page UI with auth, wallet & transfer panels
│   ├── styles.css             # Modern fintech styles, alerts, and badges
│   └── app.js                 # State, paise conversion, idempotency retry logic
├── src/
│   ├── config.js              # Centralized environment configuration
│   ├── app.js                 # Express app definition, static file serving & middlewares
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
│   │   └── walletService.js   # Atomic transactions for balance top-ups & ledger logging
│   │   └── transferService.js # P2P transfers, idempotency check, failed attempts, and history
│   └── routes/
│       ├── authRoutes.js      # POST /signup, POST /login
│       ├── walletRoutes.js    # GET /wallet, POST /wallet/add-money
│       └── transferRoutes.js  # POST /transfer, GET /transactions
├── test/
│   ├── service.test.js        # Unit & service-layer tests (runs isolated in-memory)
│   ├── api.test.js            # Full integration HTTP test suite (auth & wallet)
│   └── transfer.test.js       # Complete transfer test suite covering all 5 transfer rules
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

The server will initialize the SQLite tables automatically and listen on `http://localhost:3000`. You can open `http://localhost:3000` directly in any modern browser.

### Running Tests

MiniPay uses Node's native test runner (`node:test`):

- **Run All Tests** (Unit + Auth/Wallet API + Transfer Suites):
  ```bash
  npm test
  ```

- **Run Individual Suites**:
  ```bash
  npm run test:unit       # DB integrity & service invariants
  npm run test:e2e        # Auth and wallet endpoints
  npm run test:transfer   # Transfers and transaction history
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
  - `Idempotency-Key: <OPTIONAL_UNIQUE_KEY>`
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
        "amount_in_paise": 5000
      }
    }
  }
  ```

---

### 5. Transfer Money
Transfers money from the authenticated user to another user by email.
Executes atomically: debits sender, credits recipient, inserts two ledger entries (`DEBIT` & `CREDIT`), and records the transaction.

- **URL**: `POST /transfer`
- **Headers**:
  - `Authorization: Bearer <TOKEN>`
  - `Idempotency-Key: <REQUIRED_UNIQUE_KEY>`
- **Body**:
  ```json
  {
    "to_email": "priya@example.com",
    "amount_in_paise": 2000
  }
  ```
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "Transfer completed successfully.",
    "idempotent_replay": false,
    "data": {
      "transaction": {
        "id": 2,
        "from_wallet_id": 1,
        "to_wallet_id": 2,
        "amount_in_paise": 2000,
        "status": "SUCCESS",
        "idempotency_key": "xfer_unique_key_001",
        "created_at": "2026-11-07 10:00:00"
      },
      "sender_balance_in_paise": 3000,
      "sender_balance_inr": "₹30.00",
      "ledger_entries": [
        { "id": 2, "transaction_id": 2, "wallet_id": 1, "type": "DEBIT", "amount_in_paise": 2000 },
        { "id": 3, "transaction_id": 2, "wallet_id": 2, "type": "CREDIT", "amount_in_paise": 2000 }
      ]
    }
  }
  ```
- **Idempotent Replay** (`200 OK` when repeated with identical key & body):
  ```json
  {
    "success": true,
    "message": "Transfer previously completed (idempotent replay).",
    "idempotent_replay": true,
    "data": { ... }
  }
  ```
- **Key Collision** (`409 Conflict` when repeating key with different body/user):
  ```json
  {
    "success": false,
    "error": "Idempotency key collision: This key was already used with a different request payload."
  }
  ```
- **Insufficient Funds** (`400 Bad Request` - saves a `FAILED` transaction record without moving money):
  ```json
  {
    "success": false,
    "error": "Insufficient balance for transfer.",
    "idempotent_replay": false,
    "data": {
      "transaction": {
        "id": 3,
        "from_wallet_id": 1,
        "to_wallet_id": 2,
        "amount_in_paise": 50000,
        "status": "FAILED",
        "idempotency_key": "xfer_fail_key"
      }
    }
  }
  ```

---

### 6. List Transactions (Sent & Received Transfers)
Returns the history of sent and received transfers for the logged-in user, ordered newest first.

- **URL**: `GET /transactions`
- **Headers**:
  - `Authorization: Bearer <TOKEN>`
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "transactions": [
      {
        "id": 2,
        "from_wallet_id": 1,
        "to_wallet_id": 2,
        "amount_in_paise": 2000,
        "formatted_inr": "₹20.00",
        "status": "SUCCESS",
        "idempotency_key": "xfer_unique_key_001",
        "created_at": "2026-11-07 10:00:00",
        "from_email": "arjun@example.com",
        "to_email": "priya@example.com",
        "direction": "SENT"
      }
    ],
    "data": {
      "transactions": [ ... ],
      "count": 1
    }
  }
  ```

---

## 🧪 Quick Test Walkthrough with cURL

```bash
# 1. Sign up Alice
curl -X POST http://localhost:3000/signup \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@test.com","password":"password123"}'

# 2. Login Alice (save token as ALICE_TOKEN)
curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@test.com","password":"password123"}'

# 3. Sign up Bob
curl -X POST http://localhost:3000/signup \
  -H "Content-Type: application/json" \
  -d '{"name":"Bob","email":"bob@test.com","password":"password123"}'

# 4. Add ₹100 (10000 paise) to Alice
curl -X POST http://localhost:3000/wallet/add-money \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ALICE_TOKEN>" \
  -d '{"amount_in_paise": 10000}'

# 5. Transfer ₹30 (3000 paise) from Alice to Bob
curl -X POST http://localhost:3000/transfer \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ALICE_TOKEN>" \
  -H "Idempotency-Key: my_tx_key_101" \
  -d '{"to_email":"bob@test.com","amount_in_paise":3000}'

# 6. View transfer history (newest first)
curl -X GET http://localhost:3000/transactions \
  -H "Authorization: Bearer <ALICE_TOKEN>"
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
| `400 Bad Request` | Missing/invalid fields, floats, amounts $\le 0$, self-transfer, missing Idempotency-Key, insufficient balance |
| `401 Unauthorized` | Missing, expired, or invalid JWT token; invalid login credentials |
| `404 Not Found` | Route or recipient email does not exist |
| `409 Conflict` | Duplicate email address or Idempotency-Key collision with different body |
| `500 Server Error` | Unexpected internal server error |
