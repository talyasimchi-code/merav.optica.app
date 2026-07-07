const express = require('express');
const router = express.Router();
const db = require('./db');
const hebcal = require('./hebcal');
const requireAdmin = require('./requireAdmin');

// GET /api/blocked-dates — public, the customer calendar needs this to grey
// out closed days too.
router.get('/', (req, res) => {
  res.json({ blockedDates: db.listBlockedDates() });
});

// POST /api/blocked-dates  { date, note }  — admin manual block
router.post('/', requireAdmin, (req, res) => {
  const { date, note } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'תאריך לא תקין' });
  }
  const record = db.addBlockedDate({ date, type: 'manual', note, manual: true });
  res.status(201).json({ blockedDate: record });
});

// DELETE /api/blocked-dates/:id — admin, manual blocks only (holidays are
// re-derived automatically and can't be deleted here).
router.delete('/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const ok = db.removeBlockedDate(id);
  if (!ok) return res.status(404).json({ error: 'לא נמצא, או שמדובר בחג שמסומן אוטומטית' });
  res.json({ ok: true });
});

// POST /api/blocked-dates/sync-holidays — admin, pulls the current + next
// year's Jewish holidays from Hebcal and refreshes the auto-generated
// holiday/erev entries (manual blocks are left untouched).
router.post('/sync-holidays', requireAdmin, async (req, res) => {
  try {
    const entries = await hebcal.fetchUpcomingHolidays();
    const merged = db.replaceAutoBlockedDates(entries);
    res.json({ ok: true, blockedDates: merged });
  } catch (e) {
    console.error('Holiday sync failed:', e);
    res.status(502).json({ error: 'סנכרון לוח החגים נכשל, נסי שוב מאוחר יותר' });
  }
});

module.exports = router;
