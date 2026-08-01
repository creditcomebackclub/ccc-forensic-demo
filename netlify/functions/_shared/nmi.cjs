// NMI Direct Post (transact.php) helpers for Collect.js payment_token + vault.
const https = require('https');
const { URL } = require('url');

const HARD_DECLINE_CODES = new Set([
  '200', '201', '202', '203', '204', '220', '221', '222', '223', '224', '225',
  '226', '240', '250', '251', '252', '253', '260', '261', '262', '263', '264',
]);

function nmiConfig() {
  const securityKey = process.env.NMI_SECURITY_KEY;
  const apiUrl = (process.env.NMI_API_URL || 'https://secure.nmi.com').replace(/\/$/, '');
  return { securityKey, apiUrl, autoCharge: process.env.BILLING_AUTO_CHARGE === 'true' };
}

function postForm(urlString, fields) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null) continue;
      body.append(k, String(v));
    }
    const payload = body.toString();
    const u = new URL(urlString);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, raw }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function parseNmiResponse(raw) {
  const params = new URLSearchParams(raw || '');
  const out = {};
  for (const [k, v] of params.entries()) out[k] = v;
  const response = out.response; // 1=approved, 2=declined, 3=error
  return {
    response,
    responseText: out.responsetext || out.response_text || '',
    transactionId: out.transactionid || out.transaction_id || null,
    customerVaultId: out.customer_vault_id || out.customer_vaultid || null,
    authCode: out.authcode || null,
    avsResponse: out.avsresponse || null,
    cvvResponse: out.cvvresponse || null,
    responseCode: out.response_code || out.responsecode || null,
    orderId: out.orderid || null,
    raw: out,
  };
}

function classifyDecline(parsed) {
  if (parsed.response === '1') return null;
  const code = String(parsed.responseCode || '');
  if (HARD_DECLINE_CODES.has(code)) return 'hard';
  // response=3 is gateway/processor error — treat as soft/retryable
  if (parsed.response === '3') return 'soft';
  return 'soft';
}

function trimRaw(parsed) {
  if (!parsed || !parsed.raw) return null;
  const r = parsed.raw;
  return {
    response: r.response,
    responsetext: r.responsetext || r.response_text,
    transactionid: r.transactionid || r.transaction_id,
    customer_vault_id: r.customer_vault_id || r.customer_vaultid,
    response_code: r.response_code || r.responsecode,
    avsresponse: r.avsresponse,
    cvvresponse: r.cvvresponse,
  };
}

async function nmiTransact(fields) {
  const { securityKey, apiUrl } = nmiConfig();
  if (!securityKey) {
    const err = new Error('NMI_SECURITY_KEY not configured');
    err.code = 'NMI_NOT_CONFIGURED';
    throw err;
  }
  const { status, raw } = await postForm(`${apiUrl}/api/transact.php`, {
    security_key: securityKey,
    ...fields,
  });
  const parsed = parseNmiResponse(raw);
  parsed.httpStatus = status;
  parsed.declineType = classifyDecline(parsed);
  parsed.approved = parsed.response === '1';
  parsed.trimmed = trimRaw(parsed);
  return parsed;
}

/** Board Collect.js token into Customer Vault with $0 auth. */
async function vaultWithZeroAuth({ paymentToken, customerVaultId, billing }) {
  const fields = {
    type: 'auth',
    amount: '0.00',
    payment_token: paymentToken,
    customer_vault: customerVaultId ? 'update_customer' : 'add_customer',
    initiated_by: 'customer',
    stored_credential_indicator: 'stored',
  };
  if (customerVaultId) fields.customer_vault_id = customerVaultId;
  if (billing) {
    if (billing.firstName) fields.first_name = billing.firstName;
    if (billing.lastName) fields.last_name = billing.lastName;
    if (billing.email) fields.email = billing.email;
    if (billing.address1) fields.address1 = billing.address1;
    if (billing.city) fields.city = billing.city;
    if (billing.state) fields.state = billing.state;
    if (billing.zip) fields.zip = billing.zip;
    if (billing.phone) fields.phone = billing.phone;
  }
  return nmiTransact(fields);
}

/** Sale against an existing vault id (MIT when initialTransactionId present). */
async function saleWithVault({ customerVaultId, amount, orderId, initialTransactionId, attemptNumber }) {
  const fields = {
    type: 'sale',
    amount: Number(amount).toFixed(2),
    customer_vault_id: customerVaultId,
    initiated_by: 'merchant',
    stored_credential_indicator: 'used',
  };
  if (orderId) fields.orderid = orderId;
  if (initialTransactionId) fields.initial_transaction_id = initialTransactionId;
  if (attemptNumber) fields.merchant_defined_field_1 = String(attemptNumber);
  return nmiTransact(fields);
}

module.exports = {
  nmiConfig,
  nmiTransact,
  vaultWithZeroAuth,
  saleWithVault,
  parseNmiResponse,
  classifyDecline,
  HARD_DECLINE_CODES,
};
