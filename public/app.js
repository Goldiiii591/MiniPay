// public/app.js
// MiniPay Frontend Client
// Features:
// 1. JWT authentication stored in localStorage.
// 2. Integer paise conversion for all monetary inputs (Rupees -> Paise).
// 3. Idempotency-Key generation (crypto.randomUUID()) and reuse on retry.
// 4. Live balance fetching & transfer history.

// --- STATE MANAGEMENT ---
let authToken = localStorage.getItem('minipay_token') || null;
let currentUser = null;
try {
  currentUser = JSON.parse(localStorage.getItem('minipay_user') || 'null');
} catch (e) {
  currentUser = null;
}

// Active idempotency key state for transfer retries
// WHY THIS EXISTS:
// In payment systems, if a user clicks submit and encounters a network glitch or timeout,
// they may click "Submit" or "Retry" again.
// We preserve the generated key for the active { to_email, amount_in_paise } pair so that
// retrying sends the EXACT same Idempotency-Key, guaranteeing the backend will not double-debit.
let activeTransferKey = null;
let activeTransferPayload = null;

// --- DOM ELEMENTS ---
const authView = document.getElementById('auth-view');
const dashboardView = document.getElementById('dashboard-view');
const globalAlert = document.getElementById('global-alert');

// Navigation user section
const navUserSection = document.getElementById('nav-user-section');
const navUserAvatar = document.getElementById('nav-user-avatar');
const navUserName = document.getElementById('nav-user-name');
const navUserEmail = document.getElementById('nav-user-email');
const logoutBtn = document.getElementById('logout-btn');

// Tabs
const tabLogin = document.getElementById('tab-login');
const tabSignup = document.getElementById('tab-signup');
const loginContainer = document.getElementById('login-container');
const signupContainer = document.getElementById('signup-container');

// Forms
const loginForm = document.getElementById('login-form');
const loginAlert = document.getElementById('login-alert');
const signupForm = document.getElementById('signup-form');
const signupAlert = document.getElementById('signup-alert');

// Dashboard elements
const displayBalanceInr = document.getElementById('display-balance-inr');
const displayBalancePaise = document.getElementById('display-balance-paise');
const refreshBalanceBtn = document.getElementById('refresh-balance-btn');

// Add Money form
const addMoneyForm = document.getElementById('add-money-form');
const addAmountInrInput = document.getElementById('add-amount-inr');
const addPaisePreview = document.getElementById('add-paise-preview');
const addMoneyAlert = document.getElementById('add-money-alert');
const amountChips = document.querySelectorAll('.chip');

// Send Money form
const sendMoneyForm = document.getElementById('send-money-form');
const sendToEmailInput = document.getElementById('send-to-email');
const sendAmountInrInput = document.getElementById('send-amount-inr');
const sendPaisePreview = document.getElementById('send-paise-preview');
const displayIdempotencyKey = document.getElementById('display-idempotency-key');
const sendMoneyAlert = document.getElementById('send-money-alert');
const retrySendBtn = document.getElementById('retry-send-btn');
const sendSubmitBtn = document.getElementById('send-money-submit-btn');

// Transactions
const transactionsList = document.getElementById('transactions-list');
const historyLoading = document.getElementById('history-loading');
const historyEmpty = document.getElementById('history-empty');
const refreshHistoryBtn = document.getElementById('refresh-history-btn');

// --- HELPER FUNCTIONS ---

/**
 * Display a banner alert inside a specified container
 */
function showAlert(element, message, type = 'danger', timeoutMs = 6000) {
  element.className = `alert alert-${type}`;
  element.innerHTML = message;
  element.classList.remove('hidden');

  if (timeoutMs > 0) {
    setTimeout(() => {
      element.classList.add('hidden');
    }, timeoutMs);
  }
}

/**
 * WHY CONVERT RUPEES TO INTEGER PAISE:
 * In JavaScript and IEEE 754 floating-point systems, decimal numbers suffer from precision issues
 * (e.g., 0.1 + 0.2 = 0.30000000000000004).
 * Financial transactions must never use floating-point numbers.
 * We multiply decimal Rupees by 100 and Math.round() to obtain an exact integer in paise
 * (1 INR = 100 paise).
 */
function rupeesToPaise(rupees) {
  const num = parseFloat(rupees);
  if (isNaN(num) || num <= 0) return null;
  return Math.round(num * 100);
}

function paiseToInrString(paise) {
  return `₹${(Number(paise || 0) / 100).toFixed(2)}`;
}

// Format ISO date string into readable local time
function formatDateTime(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// --- TAB SWITCHING ---
tabLogin.addEventListener('click', () => {
  tabLogin.classList.add('active');
  tabSignup.classList.remove('active');
  loginContainer.classList.remove('hidden');
  signupContainer.classList.add('hidden');
});

tabSignup.addEventListener('click', () => {
  tabSignup.classList.add('active');
  tabLogin.classList.remove('active');
  signupContainer.classList.remove('hidden');
  loginContainer.classList.add('hidden');
});

// --- AUTHENTICATION ACTIONS ---

// Login Form Submit
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (!email || !password) {
    showAlert(loginAlert, 'Please enter both email and password.');
    return;
  }

  const submitBtn = document.getElementById('login-submit-btn');
  submitBtn.disabled = true;
  submitBtn.innerText = 'Logging in...';

  try {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Login failed. Please check your credentials.');
    }

    // Save token and user details in localStorage
    authToken = data.data.token;
    currentUser = data.data.user;
    localStorage.setItem('minipay_token', authToken);
    localStorage.setItem('minipay_user', JSON.stringify(currentUser));

    loginForm.reset();
    showDashboard();
    showAlert(globalAlert, `Welcome back, <strong>${currentUser.name}</strong>!`, 'success', 4000);
  } catch (err) {
    showAlert(loginAlert, err.message, 'danger');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = 'Log In';
  }
});

// Signup Form Submit
signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;

  if (!name || !email || !password) {
    showAlert(signupAlert, 'Please fill in all fields.');
    return;
  }

  if (password.length < 6) {
    showAlert(signupAlert, 'Password must be at least 6 characters long.');
    return;
  }

  const submitBtn = document.getElementById('signup-submit-btn');
  submitBtn.disabled = true;
  submitBtn.innerText = 'Creating Account...';

  try {
    const res = await fetch('/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create account.');
    }

    showAlert(
      signupAlert,
      'Account created successfully! Auto-logging you in...',
      'success',
      3000
    );

    // Auto-login after signup
    const loginRes = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const loginData = await loginRes.json();

    authToken = loginData.data.token;
    currentUser = loginData.data.user;
    localStorage.setItem('minipay_token', authToken);
    localStorage.setItem('minipay_user', JSON.stringify(currentUser));

    signupForm.reset();
    showDashboard();
    showAlert(globalAlert, `Account created! Welcome to MiniPay, <strong>${currentUser.name}</strong>.`, 'success', 5000);
  } catch (err) {
    showAlert(signupAlert, err.message, 'danger');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = 'Create Wallet';
  }
});

// Logout Action
logoutBtn.addEventListener('click', () => {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('minipay_token');
  localStorage.removeItem('minipay_user');
  activeTransferKey = null;
  activeTransferPayload = null;

  showAuth();
  showAlert(globalAlert, 'You have been logged out safely.', 'info', 4000);
});

// View Toggle
function showDashboard() {
  authView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  navUserSection.classList.remove('hidden');

  if (currentUser) {
    navUserName.innerText = currentUser.name || 'User';
    navUserEmail.innerText = currentUser.email || '';
    navUserAvatar.innerText = (currentUser.name || 'U').charAt(0).toUpperCase();
  }

  fetchWallet();
  fetchTransactions();
}

function showAuth() {
  authView.classList.remove('hidden');
  dashboardView.classList.add('hidden');
  navUserSection.classList.add('hidden');
}

// --- WALLET DATA FETCHING ---
async function fetchWallet() {
  if (!authToken) return;

  try {
    const res = await fetch('/wallet', {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    if (res.status === 401) {
      // Token expired or invalid
      logoutBtn.click();
      return;
    }

    const data = await res.json();
    if (data.success && data.data) {
      const balancePaise = data.data.balance_in_paise;
      displayBalanceInr.innerText = data.data.formatted_inr || paiseToInrString(balancePaise);
      displayBalancePaise.innerText = Number(balancePaise).toLocaleString();
    }
  } catch (err) {
    console.error('Failed to fetch wallet balance:', err);
  }
}

refreshBalanceBtn.addEventListener('click', () => {
  refreshBalanceBtn.style.transform = 'rotate(360deg)';
  refreshBalanceBtn.style.transition = 'transform 0.4s';
  fetchWallet().then(() => {
    setTimeout(() => {
      refreshBalanceBtn.style.transform = '';
      refreshBalanceBtn.style.transition = '';
    }, 400);
  });
});

// --- ADD MONEY (RUPEES -> PAISE) ---

// Realtime paise preview on Add Money input
addAmountInrInput.addEventListener('input', () => {
  const paise = rupeesToPaise(addAmountInrInput.value);
  addPaisePreview.innerText = paise ? Number(paise).toLocaleString() : '0';
});

// Quick Chips
amountChips.forEach((chip) => {
  chip.addEventListener('click', () => {
    const val = chip.getAttribute('data-amount');
    addAmountInrInput.value = val;
    addAmountInrInput.dispatchEvent(new Event('input'));
  });
});

addMoneyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const amountInPaise = rupeesToPaise(addAmountInrInput.value);

  if (!amountInPaise || amountInPaise <= 0) {
    showAlert(addMoneyAlert, 'Please enter a valid amount greater than 0.');
    return;
  }

  const submitBtn = document.getElementById('add-money-submit-btn');
  submitBtn.disabled = true;
  submitBtn.innerText = 'Adding Funds...';

  try {
    const res = await fetch('/wallet/add-money', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      },
      // Money is sent strictly as integer paise to the backend
      body: JSON.stringify({ amount_in_paise: amountInPaise })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to add money.');
    }

    showAlert(
      addMoneyAlert,
      `Successfully added <strong>${paiseToInrString(amountInPaise)}</strong> to your wallet!`,
      'success',
      5000
    );

    addMoneyForm.reset();
    addPaisePreview.innerText = '0';
    fetchWallet();
  } catch (err) {
    showAlert(addMoneyAlert, err.message, 'danger');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = 'Add to Wallet';
  }
});

// --- SEND MONEY (TRANSFER WITH IDEMPOTENCY) ---

// Live paise preview for transfer input
sendAmountInrInput.addEventListener('input', () => {
  const paise = rupeesToPaise(sendAmountInrInput.value);
  sendPaisePreview.innerText = paise ? Number(paise).toLocaleString() : '0';
  checkPayloadChanged();
});

sendToEmailInput.addEventListener('input', () => {
  checkPayloadChanged();
});

// Invalidate pending idempotency key if the user changes the form inputs
function checkPayloadChanged() {
  if (activeTransferPayload) {
    const currentEmail = sendToEmailInput.value.trim().toLowerCase();
    const currentPaise = rupeesToPaise(sendAmountInrInput.value);

    if (
      currentEmail !== activeTransferPayload.to_email ||
      currentPaise !== activeTransferPayload.amount_in_paise
    ) {
      // User modified the transfer parameters -> reset active idempotency key
      activeTransferKey = null;
      activeTransferPayload = null;
      displayIdempotencyKey.innerText = 'New key will be generated on submit';
      retrySendBtn.classList.add('hidden');
    }
  }
}

// Main Send Money Submit Handler
sendMoneyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  await executeTransfer(false);
});

// Retry Button Handler (reuses the same key)
retrySendBtn.addEventListener('click', async () => {
  await executeTransfer(true);
});

/**
 * Executes the money transfer request.
 *
 * @param {boolean} isRetry - Whether this is an intentional retry reusing the active key
 */
async function executeTransfer(isRetry = false) {
  const toEmail = sendToEmailInput.value.trim().toLowerCase();
  const amountInPaise = rupeesToPaise(sendAmountInrInput.value);

  if (!toEmail) {
    showAlert(sendMoneyAlert, 'Recipient email is required.');
    return;
  }

  if (currentUser && currentUser.email.toLowerCase() === toEmail) {
    showAlert(sendMoneyAlert, 'You cannot transfer money to yourself.');
    return;
  }

  if (!amountInPaise || amountInPaise <= 0) {
    showAlert(sendMoneyAlert, 'Please enter a valid amount greater than 0.');
    return;
  }

  // --- IDEMPOTENCY KEY LOGIC ---
  // WHY IDEMPOTENCY KEYS ARE GENERATED & REUSED:
  // 1. Generate once per submit: crypto.randomUUID() creates a globally unique identifier for this transfer intent.
  // 2. Reuse on retry: If the user retries the same { to_email, amount_in_paise }, the same key is sent in the
  //    "Idempotency-Key" header so the backend knows this is a retry and will not charge the sender twice.
  if (!isRetry || !activeTransferKey) {
    activeTransferKey = crypto.randomUUID();
    activeTransferPayload = { to_email: toEmail, amount_in_paise: amountInPaise };
  }

  displayIdempotencyKey.innerText = activeTransferKey;

  sendSubmitBtn.disabled = true;
  retrySendBtn.disabled = true;
  sendSubmitBtn.innerText = isRetry ? 'Retrying Transfer...' : 'Sending Money...';

  try {
    const res = await fetch('/transfer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
        'Idempotency-Key': activeTransferKey
      },
      body: JSON.stringify({
        to_email: toEmail,
        amount_in_paise: amountInPaise
      })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      // The transfer failed (e.g. Insufficient balance, user not found, etc.)
      const isInsufficient = data.error && data.error.toLowerCase().includes('insufficient');
      
      // Keep the activeTransferKey so the user can retry if they desire
      retrySendBtn.classList.remove('hidden');

      const replayTag = data.idempotent_replay ? ' <em>(Idempotent Replay)</em>' : '';
      throw new Error((data.error || 'Transfer failed.') + replayTag);
    }

    // --- SUCCESS ---
    const replayNote = data.idempotent_replay
      ? '<br><small>ℹ️ Note: This was an idempotent replay of a previously completed transfer.</small>'
      : '';

    showAlert(
      sendMoneyAlert,
      `🎉 Transferred <strong>${paiseToInrString(amountInPaise)}</strong> to <strong>${toEmail}</strong> successfully!${replayNote}`,
      'success',
      7000
    );

    // Reset the form and clear the active key so the next transfer generates a new key
    sendMoneyForm.reset();
    sendPaisePreview.innerText = '0';
    activeTransferKey = null;
    activeTransferPayload = null;
    displayIdempotencyKey.innerText = 'New key will be generated on submit';
    retrySendBtn.classList.add('hidden');

    // Refresh balance and transaction history
    fetchWallet();
    fetchTransactions();
  } catch (err) {
    showAlert(sendMoneyAlert, err.message, 'danger', 8000);
    // Refresh history and wallet in case a failed transaction was logged
    fetchWallet();
    fetchTransactions();
  } finally {
    sendSubmitBtn.disabled = false;
    retrySendBtn.disabled = false;
    sendSubmitBtn.innerText = 'Transfer Money';
  }
}

// --- TRANSACTIONS HISTORY ---
async function fetchTransactions() {
  if (!authToken) return;

  historyLoading.classList.remove('hidden');
  historyEmpty.classList.add('hidden');
  transactionsList.innerHTML = '';

  try {
    const res = await fetch('/transactions', {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    if (res.status === 401) {
      logoutBtn.click();
      return;
    }

    const data = await res.json();
    const transactions = (data.data && data.data.transactions) || data.transactions || [];

    historyLoading.classList.add('hidden');

    if (transactions.length === 0) {
      historyEmpty.classList.remove('hidden');
      return;
    }

    transactions.forEach((tx) => {
      const tr = document.createElement('tr');

      const isSent = tx.direction === 'SENT';
      const typeBadge = isSent
        ? `<span class="badge badge-sent">📤 Sent</span>`
        : `<span class="badge badge-received">📥 Received</span>`;

      const counterpartyEmail = isSent ? tx.to_email : tx.from_email;
      const counterpartyLabel = isSent ? `To: <strong>${counterpartyEmail}</strong>` : `From: <strong>${counterpartyEmail}</strong>`;

      const amountFormatted = paiseToInrString(tx.amount_in_paise);
      const amountClass = isSent ? 'amount-sent' : 'amount-received';
      const amountSign = isSent ? '-' : '+';

      const statusBadge =
        tx.status === 'SUCCESS'
          ? `<span class="badge badge-success">✓ SUCCESS</span>`
          : `<span class="badge badge-failed">✗ ${tx.status}</span>`;

      const timeFormatted = formatDateTime(tx.created_at);
      const shortKey = tx.idempotency_key ? `${tx.idempotency_key.substring(0, 16)}...` : '-';

      tr.innerHTML = `
        <td>${typeBadge}</td>
        <td>${counterpartyLabel}</td>
        <td class="${amountClass}">${amountSign} ${amountFormatted}</td>
        <td>${statusBadge}</td>
        <td>${timeFormatted}</td>
        <td><code title="${tx.idempotency_key || ''}">${shortKey}</code></td>
      `;

      transactionsList.appendChild(tr);
    });
  } catch (err) {
    historyLoading.classList.add('hidden');
    console.error('Failed to load transaction history:', err);
  }
}

refreshHistoryBtn.addEventListener('click', fetchTransactions);

// --- INITIAL BOOTSTRAP ---
if (authToken) {
  showDashboard();
} else {
  showAuth();
}
