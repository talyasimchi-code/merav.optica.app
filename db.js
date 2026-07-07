// Simple JSON-file-backed data store.
//
// Why not a "real" database? For a single small store with one exam room and
// one optometrist, traffic is very low (a handful of bookings per day).
// A JSON file avoids native-binding headaches (better-sqlite3 / sqlite3 need
// to be compiled for whatever server you deploy to) and is trivial to back up
// — it's just a file. If the store grows and you want a real database later,
// swap this module for a Postgres/SQLite client; every other file in the app
// only talks to the functions exported here, so the rest of the code does not
// need to change.
//
// Concurrency note: Node.js runs your request handlers on a single thread, and
// every function below is synchronous, so two requests can never interleave
// in the middle of a read-modify-write. That's what actually prevents double
// bookings — not a database transaction.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

function defaultData() {
  return {
    customers: [],
    appointments: [],
    blockedDates: [],
    nextCustomerId: 1,
    nextAppointmentId: 1,
    nextBlockedId: 1
  };
}

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData(), null, 2), 'utf8');
  }
}

function read() {
  ensureFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('store.json is corrupted, resetting to empty store:', e);
    const fresh = defaultData();
    write(fresh);
    return fresh;
  }
}

function write(data) {
  ensureFile();
  // Write to a temp file then rename, so a crash mid-write can't corrupt the
  // real file.
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

// ---------- Customers ----------

function findCustomerByPhone(phone) {
  const data = read();
  return data.customers.find(c => c.phone === phone) || null;
}

function findCustomerByNameAndPhone(fullName, phone) {
  const data = read();
  const normalized = (s) => (s || '').trim().toLowerCase();
  return (
    data.customers.find(
      c => c.phone === phone && normalized(c.fullName) === normalized(fullName)
    ) || null
  );
}

function createCustomer({ fullName, phone, isExisting, lastCheck }) {
  const data = read();
  const existing = data.customers.find(c => c.phone === phone);
  if (existing) return existing;
  const customer = {
    id: data.nextCustomerId++,
    fullName,
    phone,
    isExisting: !!isExisting,
    lastCheck: lastCheck || null,
    createdAt: new Date().toISOString()
  };
  data.customers.push(customer);
  write(data);
  return customer;
}

// ---------- Appointments ----------

function listAppointments({ status, from, to } = {}) {
  const data = read();
  return data.appointments.filter(a => {
    if (status && a.status !== status) return false;
    if (from && a.date < from) return false;
    if (to && a.date > to) return false;
    return true;
  });
}

function getAppointment(id) {
  const data = read();
  return data.appointments.find(a => a.id === id) || null;
}

function createAppointment(appt) {
  const data = read();
  const record = {
    id: data.nextAppointmentId++,
    customerId: appt.customerId || null,
    customerName: appt.customerName,
    customerPhone: appt.customerPhone,
    isExisting: !!appt.isExisting,
    date: appt.date, // 'YYYY-MM-DD'
    startTime: appt.startTime, // 'HH:MM'
    durationMinutes: appt.durationMinutes || 45,
    reason: appt.reason,
    reasonOther: appt.reasonOther || null,
    note: appt.note || null,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  data.appointments.push(record);
  write(data);
  return record;
}

function updateAppointmentStatus(id, status) {
  const data = read();
  const appt = data.appointments.find(a => a.id === id);
  if (!appt) return null;
  appt.status = status;
  appt.updatedAt = new Date().toISOString();
  write(data);
  return appt;
}

// Appointments that currently hold a slot: pending (soft hold) or approved.
// needsinfo/issue/cancelled do not block the calendar.
function activeAppointmentsForDate(date) {
  const data = read();
  return data.appointments.filter(
    a => a.date === date && (a.status === 'pending' || a.status === 'approved')
  );
}

// ---------- Blocked dates (holidays, erev chag, manual closures) ----------

function listBlockedDates() {
  const data = read();
  return data.blockedDates;
}

function findBlockedDate(date) {
  const data = read();
  return data.blockedDates.find(b => b.date === date) || null;
}

function addBlockedDate({ date, type, note, manual }) {
  const data = read();
  const already = data.blockedDates.find(b => b.date === date && b.type === type);
  if (already) return already;
  const record = {
    id: data.nextBlockedId++,
    date,
    type, // 'holiday' | 'erev' | 'manual'
    note: note || null,
    manual: !!manual
  };
  data.blockedDates.push(record);
  write(data);
  return record;
}

function removeBlockedDate(id) {
  const data = read();
  const before = data.blockedDates.length;
  data.blockedDates = data.blockedDates.filter(b => b.id !== id || !b.manual);
  write(data);
  return data.blockedDates.length < before;
}

// Used by the holiday-sync job: replace all non-manual (auto) holiday entries
// with a freshly fetched list, without touching manual blocks the owner added.
function replaceAutoBlockedDates(newEntries) {
  const data = read();
  const manualOnly = data.blockedDates.filter(b => b.manual);
  const merged = manualOnly.concat(
    newEntries.map(e => ({
      id: data.nextBlockedId++,
      date: e.date,
      type: e.type,
      note: e.note || null,
      manual: false
    }))
  );
  data.blockedDates = merged;
  write(data);
  return merged;
}

module.exports = {
  read,
  write,
  findCustomerByPhone,
  findCustomerByNameAndPhone,
  createCustomer,
  listAppointments,
  getAppointment,
  createAppointment,
  updateAppointmentStatus,
  activeAppointmentsForDate,
  listBlockedDates,
  findBlockedDate,
  addBlockedDate,
  removeBlockedDate,
  replaceAutoBlockedDates
};
