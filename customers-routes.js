const express = require('express');
const router = express.Router();
const db = require('./db');

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

// POST /api/customers/lookup { fullName, phone }
// Used on step 2a ("existing customer") to check if the person is in the
// system. Returns { found: true, customer } or { found: false }.
router.post('/lookup', (req, res) => {
  const { fullName, phone } = req.body || {};
  const digits = normalizePhone(phone);
  if (digits.length !== 10) {
    return res.status(400).json({ error: 'מספר טלפון לא תקין' });
  }
  const customer = db.findCustomerByNameAndPhone(fullName, digits);
  if (customer) {
    return res.json({ found: true, customer });
  }
  return res.json({ found: false });
});

// POST /api/customers  { fullName, phone, lastCheck }
// Used on step 2b ("new customer") to register the person before booking.
router.post('/', (req, res) => {
  const { fullName, phone, lastCheck } = req.body || {};
  const digits = normalizePhone(phone);
  if (!fullName || !fullName.trim()) {
    return res.status(400).json({ error: 'נא להזין שם מלא' });
  }
  if (digits.length !== 10) {
    return res.status(400).json({ error: 'מספר טלפון לא תקין' });
  }
  const customer = db.createCustomer({
    fullName: fullName.trim(),
    phone: digits,
    isExisting: false,
    lastCheck: lastCheck || null
  });
  return res.status(201).json({ customer });
});

module.exports = router;
