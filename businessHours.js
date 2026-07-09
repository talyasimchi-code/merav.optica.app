// Business hours + slot math.
//
// Customers always pick a slot from a grid every SLOT_GRID_MINUTES (default
// 30), e.g. 12:00 / 12:30 / 13:00 — but different visit types occupy
// different amounts of time once booked (see REASON_DURATIONS below). So
// booking a 60-minute contact-lens fitting at 12:00 locks 12:00–13:00, which
// fully blocks two grid cells; booking a 15-minute army-draft check at 12:00
// only half-blocks the 12:00–12:30 cell.

const db = require('./db');

// How long each visit reason actually locks on the calendar, in minutes.
// This is the single source of truth for appointment duration — the client
// never gets to decide this, it only tells the server which reason was
// selected and the server looks up the duration here.
const REASON_DURATIONS = {
  decline: 30, // שינוי בראייה
  refresh: 30, // רצון להתחדש
  license: 30, // בדיקה עבור משרד הרישוי
  hmo: 30, // בדיקה בעקבות הפניית קופת חולים
  lenses: 60, // התאמת עדשות מגע
  draft: 15, // בדיקת ראייה לצו ראשון
  other: 30
};
const DEFAULT_DURATION = 30;

// Customers can't book a slot starting less than this many minutes from now,
// so the staff always has some notice before someone walks in.
const BOOKING_LEAD_MINUTES = 30;

function durationForReason(reason) {
  return REASON_DURATIONS[reason] || DEFAULT_DURATION;
}

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
  return !!db.findFullDayBlock(dateStr);
}

function erevOverrideHours(dateStr) {
  if (db.findErevBlock(dateStr)) {
    // Erev chag behaves like Friday: shortened hours ending at CLOSE_FRI.
    return { open: OPEN_FRI, close: CLOSE_FRI };
  }
  return null;
}

// Manual hour-range blocks the owner added for this date, as [start,end]
// minute ranges — treated exactly like an existing appointment for the
// purposes of blocking slots, so the same full/half-cell logic in the admin
// weekly view "just works" for these too.
function blockedRangesForDate(dateStr) {
  return db.findHourBlocksForDate(dateStr).map(b => [toMinutes(b.startTime), toMinutes(b.endTime)]);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// Store hours are Israel hours regardless of which server/timezone this
// process happens to run on (most hosts run UTC). Everything that compares
// against "now" goes through this so a slot at 09:00 Israel time isn't
// accidentally treated as already-past because the server thinks it's still
// last night in UTC.
function nowInIsrael() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const map = {};
  parts.forEach(p => { map[p.type] = p.value; });
  return {
    dateStr: `${map.year}-${map.month}-${map.day}`,
    minutes: parseInt(map.hour, 10) * 60 + parseInt(map.minute, 10)
  };
}

// Returns an ordered list of { time: 'HH:MM', busy: boolean } for the given
// date and visit duration, at the configured grid resolution, taking into
// account:
//  - the store's weekly hours (and Friday/erev shortened hours)
//  - full closures (holiday, manual whole-day block, Saturday)
//  - manual hour-range blocks the owner added for that date
//  - existing pending/approved appointments that day
//  - if the date is today, the minimum booking lead time
function getAvailability(dateStr, durationMinutes) {
  const duration = durationMinutes || DEFAULT_DURATION;
  if (isClosedDate(dateStr)) return { closed: true, slots: [] };

  const hours = erevOverrideHours(dateStr) || hoursForDate(dateStr);
  if (!hours) return { closed: true, slots: [] };

  const openMin = toMinutes(hours.open);
  const closeMin = toMinutes(hours.close);
  const lastStart = closeMin - duration;
  if (lastStart < openMin) return { closed: true, slots: [] };

  const active = db.activeAppointmentsForDate(dateStr)
    .map(a => {
      const start = toMinutes(a.startTime);
      return [start, start + a.durationMinutes];
    })
    .concat(blockedRangesForDate(dateStr));

  const now = nowInIsrael();
  const isToday = dateStr === now.dateStr;

  const slots = [];
  for (let m = openMin; m <= lastStart; m += SLOT_GRID_MINUTES) {
    const candidateEnd = m + duration;
    const tooSoon = isToday && m < now.minutes + BOOKING_LEAD_MINUTES;
    const busy = tooSoon || active.some(([bS, bE]) => overlaps(m, candidateEnd, bS, bE));
    slots.push({ time: toHHMM(m), busy });
  }
  return { closed: false, slots };
}

// Server-side re-check before actually creating an appointment, so two
// people racing for the same slot can't both succeed, and so nobody can
// book a time that has already started today or that the owner blocked.
function isSlotStillFree(dateStr, startTime, durationMinutes) {
  const duration = durationMinutes || DEFAULT_DURATION;
  if (isClosedDate(dateStr)) return false;
  const hours = erevOverrideHours(dateStr) || hoursForDate(dateStr);
  if (!hours) return false;
  const openMin = toMinutes(hours.open);
  const closeMin = toMinutes(hours.close);
  const start = toMinutes(startTime);
  const end = start + duration;
  if (start < openMin || end > closeMin) return false;

  const now = nowInIsrael();
  if (dateStr === now.dateStr && start < now.minutes + BOOKING_LEAD_MINUTES) return false;

  const active = db.activeAppointmentsForDate(dateStr)
    .map(a => {
      const s = toMinutes(a.startTime);
      return [s, s + a.durationMinutes];
    })
    .concat(blockedRangesForDate(dateStr));
  return !active.some(([bS, bE]) => overlaps(start, end, bS, bE));
}

module.exports = {
  REASON_DURATIONS,
  DEFAULT_DURATION,
  durationForReason,
  SLOT_GRID_MINUTES,
  toMinutes,
  toHHMM,
  getAvailability,
  isSlotStillFree,
  isClosedDate
};
