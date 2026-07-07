// Business hours + slot math.
//
// Customers pick a slot from a grid every SLOT_GRID_MINUTES (default 30),
// e.g. 12:00 / 12:30 / 13:00 — but every appointment actually occupies
// APPOINTMENT_DURATION minutes (default 45) once booked. So booking the
// 12:00 slot locks 12:00–12:45, which fully blocks the 12:00–12:30 grid cell
// and half-blocks the 12:30–13:00 one.

const db = require('./db');

const APPOINTMENT_DURATION = parseInt(process.env.APPOINTMENT_DURATION || '45', 10);
const SLOT_GRID_MINUTES = parseInt(process.env.SLOT_GRID_MINUTES || '30', 10);

const OPEN_SUN_THU = process.env.OPEN_TIME_SUN_THU || '09:00';
const CLOSE_SUN_THU = process.env.CLOSE_TIME_SUN_THU || '19:00';
const OPEN_FRI = process.env.OPEN_TIME_FRI || '09:00';
const CLOSE_FRI = process.env.CLOSE_TIME_FRI || '14:00';

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function toHHMM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// JS Date.getDay(): 0=Sunday ... 5=Friday, 6=Saturday
function hoursForDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay();
  if (dow === 6) return null; // Saturday: always closed
  if (dow === 5) return { open: OPEN_FRI, close: CLOSE_FRI };
  return { open: OPEN_SUN_THU, close: CLOSE_SUN_THU };
}

function isClosedDate(dateStr) {
  const blocked = db.findBlockedDate(dateStr);
  if (blocked && (blocked.type === 'holiday' || blocked.type === 'manual')) {
    // Manual/holiday full closures block the whole day. Erev chag just
    // shortens the day (handled via erevHoursForDate) rather than closing it.
    return true;
  }
  return false;
}

function erevOverrideHours(dateStr) {
  const blocked = db.findBlockedDate(dateStr);
  if (blocked && blocked.type === 'erev') {
    // Erev chag behaves like Friday: shortened hours ending at CLOSE_FRI.
    return { open: OPEN_FRI, close: CLOSE_FRI };
  }
  return null;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// Returns an ordered list of { time: 'HH:MM', busy: boolean } for the given
// date, at the configured grid resolution, taking into account:
//  - the store's weekly hours (and Friday/erev shortened hours)
//  - full closures (holiday, manual block, Saturday)
//  - existing pending/approved appointments that day (45-min lock)
function getAvailability(dateStr) {
  if (isClosedDate(dateStr)) return { closed: true, slots: [] };

  const hours = erevOverrideHours(dateStr) || hoursForDate(dateStr);
  if (!hours) return { closed: true, slots: [] };

  const openMin = toMinutes(hours.open);
  const closeMin = toMinutes(hours.close);
  const lastStart = closeMin - APPOINTMENT_DURATION;
  if (lastStart < openMin) return { closed: true, slots: [] };

  const active = db.activeAppointmentsForDate(dateStr).map(a => {
    const start = toMinutes(a.startTime);
    return [start, start + a.durationMinutes];
  });

  const slots = [];
  for (let m = openMin; m <= lastStart; m += SLOT_GRID_MINUTES) {
    const candidateEnd = m + APPOINTMENT_DURATION;
    const busy = active.some(([bS, bE]) => overlaps(m, candidateEnd, bS, bE));
    slots.push({ time: toHHMM(m), busy });
  }
  return { closed: false, slots };
}

// Server-side re-check before actually creating an appointment, so two
// people racing for the same slot can't both succeed.
function isSlotStillFree(dateStr, startTime) {
  if (isClosedDate(dateStr)) return false;
  const hours = erevOverrideHours(dateStr) || hoursForDate(dateStr);
  if (!hours) return false;
  const openMin = toMinutes(hours.open);
  const closeMin = toMinutes(hours.close);
  const start = toMinutes(startTime);
  const end = start + APPOINTMENT_DURATION;
  if (start < openMin || end > closeMin) return false;

  const active = db.activeAppointmentsForDate(dateStr).map(a => {
    const s = toMinutes(a.startTime);
    return [s, s + a.durationMinutes];
  });
  return !active.some(([bS, bE]) => overlaps(start, end, bS, bE));
}

module.exports = {
  APPOINTMENT_DURATION,
  SLOT_GRID_MINUTES,
  toMinutes,
  toHHMM,
  getAvailability,
  isSlotStillFree,
  isClosedDate
};
