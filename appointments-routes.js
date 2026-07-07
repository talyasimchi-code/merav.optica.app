const express = require('express');
const router = express.Router();
const db = require('./db');
const businessHours = require('./businessHours');
const requireAdmin = require('./requireAdmin');

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

const VALID_REASONS = ['decline', 'refresh', 'license', 'hmo', 'other'];

// GET /api/appointments/availability?date=YYYY-MM-DD
// Public — used by the booking calendar to render open/closed/busy slots.
router.get('/availability', (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'תאריך לא תקין' });
  }
  const result = businessHours.getAvailability(date);
  res.json(result);
});

// POST /api/appointments
// Public — creates a new appointment request with status "pending" (the
// "soft hold" described in the spec: the slot is blocked from other
// customers immediately, pending owner approval).
router.post('/', (req, res) => {
  const {
    customerName,
    customerPhone,
    isExisting,
    date,
    startTime,
    reason,
    reasonOther,
    note
  } = req.body || {};

  const digits = normalizePhone(customerPhone);
  if (!customerName || !customerName.trim()) {
    return res.status(400).json({ error: 'נא להזין שם מלא' });
  }
  if (digits.length !== 10) {
    return res.status(400).json({ error: 'מספר טלפון לא תקין' });
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'תאריך לא תקין' });
  }
  if (!startTime || !/^\d{2}:\d{2}$/.test(startTime)) {
    return res.status(400).json({ error: 'שעה לא תקינה' });
  }
  if (!VALID_REASONS.includes(reason)) {
    return res.status(400).json({ error: 'סיבת פנייה לא תקינה' });
  }
  if (reason === 'other' && (!reasonOther || !reasonOther.trim())) {
    return res.status(400).json({ error: 'נא לפרט את סיבת הפנייה' });
  }

  // Re-check on the server — the availability the client saw might be stale
  // by the time it submits (e.g. someone else grabbed the slot a second ago).
  if (!businessHours.isSlotStillFree(date, startTime)) {
    return res.status(409).json({ error: 'השעה שבחרת כבר לא פנויה, אנא בחר/י שעה אחרת' });
  }

  const appt = db.createAppointment({
    customerName: customerName.trim(),
    customerPhone: digits,
    isExisting: !!isExisting,
    date,
    startTime,
    durationMinutes: businessHours.APPOINTMENT_DURATION,
    reason,
    reasonOther: reason === 'other' ? reasonOther.trim() : null,
    note: note ? note.trim() : null
  });

  res.status(201).json({ appointment: appt });
});

// ---- Admin-only endpoints below ----

// GET /api/appointments?status=pending
router.get('/', requireAdmin, (req, res) => {
  const { status, from, to } = req.query;
  const list = db.listAppointments({ status, from, to });
  // Most recent request first for the pending queue, chronological for others
  list.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  res.json({ appointments: list });
});

// PATCH /api/appointments/:id  { status }
const VALID_STATUSES = ['pending', 'approved', 'needsinfo', 'issue', 'cancelled'];
router.patch('/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status } = req.body || {};
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'סטטוס לא תקין' });
  }
  const updated = db.updateAppointmentStatus(id, status);
  if (!updated) return res.status(404).json({ error: 'תור לא נמצא' });
  res.json({ appointment: updated });
});

module.exports = router;
