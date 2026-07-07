require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

const customersRouter = require('./customers-routes');
const appointmentsRouter = require('./appointments-routes');
const blockedRouter = require('./blocked-routes');
const adminRouter = require('./admin-routes');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SESSION_SECRET) {
  console.warn(
    '[WARNING] SESSION_SECRET is not set in .env — using an insecure default. ' +
      'Set a real random value before deploying.'
  );
}

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // secure:true requires HTTPS. Most hosts (Render, Railway, Vercel,
      // etc.) terminate TLS in front of your app, so this is normally safe
      // to enable in production. Uncomment once you've deployed behind HTTPS:
      // secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 8 // 8 hours
    }
  })
);

// ---- Static files ----
// Everything lives in one flat folder (no subfolders), so each file is
// served explicitly rather than pointing express.static() at a directory.
// This also means server-side files (server.js, db.js, .env, etc.) are
// never accidentally exposed — only the files listed below are public.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/styles.css', (req, res) => res.sendFile(path.join(__dirname, 'styles.css')));
app.get('/customer-app.js', (req, res) => res.sendFile(path.join(__dirname, 'customer-app.js')));
app.get('/admin-app.js', (req, res) => res.sendFile(path.join(__dirname, 'admin-app.js')));
app.get('/logo.png', (req, res) => res.sendFile(path.join(__dirname, 'logo.png')));

// ---- API ----
app.get('/api/config', (req, res) => {
  res.json({
    storeWhatsapp: process.env.STORE_WHATSAPP || '',
    appointmentDuration: parseInt(process.env.APPOINTMENT_DURATION || '45', 10),
    slotGridMinutes: parseInt(process.env.SLOT_GRID_MINUTES || '30', 10)
  });
});

app.use('/api/customers', customersRouter);
app.use('/api/appointments', appointmentsRouter);
app.use('/api/blocked-dates', blockedRouter);
app.use('/api/admin', adminRouter);

app.listen(PORT, () => {
  console.log(`מירב האופטיקה — booking server running on http://localhost:${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
});
