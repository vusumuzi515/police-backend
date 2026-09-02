/**
 * TECHLAW Police shared API with Supabase backend
 * Run: npm install && npm start  (from POLICE APP folder)
 * Citizen app: citizen-mobile/ (Expo) → EXPO_PUBLIC_API_URL → this server
 * Admin app:   police-admin/ (Vite) → http://localhost:5174 or /communications after build
 * Default admin login: username MELU101, password Melu123!
 * Database: Supabase PostgreSQL with Storage bucket for evidence
 */
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'prototype-db.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Supabase client
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY 
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

const USE_SUPABASE = supabase !== null;

// Debug: Log Supabase configuration on startup
console.log('=== SUPABASE CONFIGURATION ===');
console.log('SUPABASE_URL:', SUPABASE_URL ? 'SET (' + SUPABASE_URL.substring(0, 30) + '...)' : 'NOT SET');
console.log('SUPABASE_SERVICE_KEY:', SUPABASE_SERVICE_KEY ? 'SET (' + SUPABASE_SERVICE_KEY.substring(0, 20) + '...)' : 'NOT SET');
console.log('USE_SUPABASE (client initialized):', USE_SUPABASE);
console.log('==============================');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

const evidenceStorage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (_req, file, cb) {
    const safeBase = (file.originalname || 'evidence').replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '-' + safeBase);
  }
});
const uploadEvidence = multer({
  storage: evidenceStorage,
  limits: { fileSize: 80 * 1024 * 1024 },
});
const uploadAudio = multer({
  storage: evidenceStorage,
  limits: { fileSize: 80 * 1024 * 1024 },
});

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const defaultUsername = 'MELU101';
  const defaultPassword = 'Melu123!';
  const buildDefaultOfficer = function () {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(defaultPassword, salt, 100000, 32, 'sha256').toString('hex');
    return {
      badge: defaultUsername,
      name: 'Command Center Admin',
      rank: 'Command Center Admin',
      salt,
      passwordHash: hash
    };
  };
  if (!fs.existsSync(DB_PATH)) {
    const initial = {
      officers: [buildDefaultOfficer()],
      reports: [],
      notices: [],
      distressSessions: [],
      loginAttempts: {},
      sessions: {},
      citizens: [],
      citizenOtps: {},
      citizenSessions: {},
      settings: normalizeSettings(null),
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), 'utf8');
  } else {
    // Normalize schema without wiping active sessions/data on every request.
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

    if (!Array.isArray(db.officers)) db.officers = [];
    if (!Array.isArray(db.reports)) db.reports = [];
    if (!Array.isArray(db.notices)) db.notices = [];
    if (!Array.isArray(db.distressSessions)) db.distressSessions = [];
    if (!db.loginAttempts || typeof db.loginAttempts !== 'object') db.loginAttempts = {};
    if (!db.sessions || typeof db.sessions !== 'object') db.sessions = {};
    if (!Array.isArray(db.citizens)) db.citizens = [];
    if (!db.citizenOtps || typeof db.citizenOtps !== 'object') db.citizenOtps = {};
    if (!db.citizenSessions || typeof db.citizenSessions !== 'object') db.citizenSessions = {};
    db.settings = normalizeSettings(db.settings);

    // Ensure requested default account exists and has the requested password.
    const idx = db.officers.findIndex((o) => String(o.badge) === defaultUsername);
    const nextOfficer = buildDefaultOfficer();
    if (idx === -1) db.officers.unshift(nextOfficer);
    else db.officers[idx] = { ...db.officers[idx], ...nextOfficer, badge: defaultUsername };

    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  }
}

function readDb() {
  ensureDb();
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  if (!Array.isArray(db.distressSessions)) db.distressSessions = [];
  if (!Array.isArray(db.reports)) db.reports = [];
  db.settings = normalizeSettings(db.settings);
  return db;
}

function writeDb(db) {
  db.settings = normalizeSettings(db.settings);
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

// ============= SUPABASE HELPERS (for reports and evidence) =============

async function fetchReportsFromSupabase() {
  if (!USE_SUPABASE) return null;
  try {
    let result = await supabase
      .from('reports')
      .select('*')
      .order('timestamp', { ascending: false });

    if (result.error && result.error.code === '42703') {
      result = await supabase
        .from('reports')
        .select('*');
    }

    if (result.error) {
      console.error('Supabase fetch reports error:', result.error);
      return null;
    }
    return result.data || [];
  } catch (err) {
    console.error('Supabase fetch reports exception:', err);
    return null;
  }
}

async function createReportInSupabase(report) {
  if (!USE_SUPABASE) {
    console.error('🔴 [createReportInSupabase] USE_SUPABASE is false, skipping');
    return null;
  }
  try {
    console.error('🟡 [createReportInSupabase] Inserting into database:', report.id);
    const { data, error } = await supabase
      .from('reports')
      .insert([report])
      .select();
    if (error) {
      console.error('🔴 [createReportInSupabase] ERROR:', JSON.stringify(error));
      return null;
    }
    console.error('✅ [createReportInSupabase] INSERTED:', data?.[0]?.id);
    return data?.[0] || null;
  } catch (err) {
    console.error('🔴 [createReportInSupabase] EXCEPTION:', err.message);
    return null;
  }
}

async function uploadEvidenceToSupabase(bucket, fileName, fileBuffer, mimeType) {
  if (!USE_SUPABASE) return null;
  try {
    const { data, error } = await supabase
      .storage
      .from(bucket)
      .upload(fileName, fileBuffer, {
        contentType: mimeType,
        upsert: false
      });
    if (error) {
      console.error('Supabase upload error:', error);
      return null;
    }
    return data?.path || null;
  } catch (err) {
    console.error('Supabase upload exception:', err);
    return null;
  }
}

function getSupabaseStorageUrl(bucket, path) {
  if (!USE_SUPABASE) return null;
  const baseUrl = SUPABASE_URL.replace(/\/$/, '');
  return `${baseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

const DEFAULT_SETTINGS = {
  /** Days to keep citizen reports on the dashboard. 0 = keep forever. */
  reportRetentionDays: 30,
  /**
   * Days to keep closed Get Help / live alerts (resolved, expired, ended).
   * Active alerts are never auto-deleted. 0 = keep forever.
   */
  liveAlertRetentionDays: 30,
};

function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const toDays = (value, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.min(3650, Math.floor(n));
  };
  return {
    reportRetentionDays: toDays(src.reportRetentionDays, DEFAULT_SETTINGS.reportRetentionDays),
    liveAlertRetentionDays: toDays(
      src.liveAlertRetentionDays,
      DEFAULT_SETTINGS.liveAlertRetentionDays,
    ),
  };
}

function collectUploadFilenamesFromReport(report) {
  const names = [];
  const files = report && report.payload && report.payload.evidenceFiles;
  if (!Array.isArray(files)) return names;
  for (const file of files) {
    if (file && file.storedName) names.push(file.storedName);
    else if (file && typeof file.url === 'string' && file.url.startsWith('/uploads/')) {
      names.push(file.url.slice('/uploads/'.length));
    }
  }
  return names;
}

function collectUploadFilenamesFromDistress(session) {
  const names = [];
  if (session && typeof session.audioUrl === 'string' && session.audioUrl.startsWith('/uploads/')) {
    names.push(session.audioUrl.slice('/uploads/'.length));
  }
  return names;
}

function deleteUploadFiles(filenames) {
  for (const name of filenames) {
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) continue;
    const full = path.join(UPLOADS_DIR, name);
    try {
      if (fs.existsSync(full)) fs.unlinkSync(full);
    } catch {
      /* ignore */
    }
  }
}

function isOlderThanDays(isoDate, days) {
  if (!days || days <= 0) return false;
  if (!isoDate) return false;
  const ms = new Date(isoDate).getTime();
  if (!Number.isFinite(ms)) return false;
  return Date.now() - ms > days * 24 * 60 * 60 * 1000;
}

/**
 * Remove old citizen reports and closed live alerts based on dashboard settings.
 * Active / acknowledged Get Help sessions are never removed automatically.
 */
function purgeExpiredRecords(db) {
  const settings = normalizeSettings(db.settings);
  db.settings = settings;
  let changed = false;
  const filesToDelete = [];

  if (settings.reportRetentionDays > 0) {
    const kept = [];
    for (const report of db.reports || []) {
      const ageDate = report.timestamp || report.closedAt;
      if (isOlderThanDays(ageDate, settings.reportRetentionDays)) {
        filesToDelete.push(...collectUploadFilenamesFromReport(report));
        changed = true;
      } else {
        kept.push(report);
      }
    }
    db.reports = kept;
  }

  if (settings.liveAlertRetentionDays > 0) {
    const closedStatuses = new Set(['resolved', 'ended_by_citizen', 'expired']);
    const kept = [];
    for (const session of db.distressSessions || []) {
      const isClosed = closedStatuses.has(session.status);
      const ageDate = session.endedAt || session.lastPingAt || session.startedAt;
      if (isClosed && isOlderThanDays(ageDate, settings.liveAlertRetentionDays)) {
        filesToDelete.push(...collectUploadFilenamesFromDistress(session));
        changed = true;
      } else {
        kept.push(session);
      }
    }
    db.distressSessions = kept;
  }

  if (changed) {
    writeDb(db);
    deleteUploadFiles(filesToDelete);
  }
  return { db, settings, changed };
}

const STALE_PING_MS = 5 * 60 * 1000;

function normalizeDistressPriority(priority, source) {
  if (priority === 'high') return 'high';
  if (
    priority === 'assistance' ||
    priority === 'facata' ||
    source === 'panic_button' ||
    source === 'facata_call' ||
    source === 'citizen_mobile'
  ) {
    return 'high';
  }
  return 'regular';
}

function isFacataAlert(body, source) {
  const alertType = String(body.alertType || body.type || '').toLowerCase();
  return (
    alertType === 'facata' ||
    source === 'facata_call' ||
    String(body.priority || '').toLowerCase() === 'facata'
  );
}

function expireStaleDistressSessions(db) {
  const now = Date.now();
  let changed = false;
  for (const s of db.distressSessions) {
    if (!s || s.status !== 'active') continue;
    // Keep live Get Help alerts on the map until an officer resolves them.
    if (s.audioUrl) continue;
    const last = s.lastPingAt || s.startedAt;
    const lastMs = last ? new Date(last).getTime() : 0;
    const staleByPing = lastMs && now - lastMs > STALE_PING_MS;
    if (staleByPing) {
      s.status = 'expired';
      s.endedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) writeDb(db);
  return db;
}

function listOpenDistressSessions(db) {
  return db.distressSessions
    .filter((x) => x && (x.status === 'active' || x.status === 'acknowledged'))
    .sort((a, b) => {
      const pa = a.priority === 'high' ? 0 : 1;
      const pb = b.priority === 'high' ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
    });
}

function hashPassword(password, saltHex) {
  return crypto.pbkdf2Sync(password, saltHex, 100000, 32, 'sha256').toString('hex');
}

function verifyOfficer(db, badge, password) {
  const b = String(badge).trim();
  const officer = db.officers.find((o) => String(o.badge) === b);
  if (!officer || !officer.salt || !officer.passwordHash) return null;
  if (hashPassword(password, officer.salt) !== officer.passwordHash) return null;
  return { badge: officer.badge, name: officer.name, rank: officer.rank };
}

const LOCKOUT_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;

function authMiddleware(req, res, next) {
  const token =
    req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const db = readDb();
  const sess = db.sessions[token];
  if (!sess || Date.now() > sess.expiresAt) return res.status(401).json({ error: 'Session expired' });
  req.officer = sess;
  next();
}

app.post('/api/auth/login', (req, res) => {
  const { badge, password } = req.body || {};
  if (!badge || !password) return res.status(400).json({ error: 'Badge and password required' });

  let db = readDb();
  const b = String(badge).trim();
  const lock = db.loginAttempts[b];
  if (lock && lock.lockUntil && Date.now() < lock.lockUntil) {
    return res.status(423).json({ error: 'Account locked. Try again later.', lockUntil: lock.lockUntil });
  }

  const officer = verifyOfficer(db, badge, password);
  if (!officer) {
    if (!db.loginAttempts[b]) db.loginAttempts[b] = { attempts: 0 };
    db.loginAttempts[b].attempts = (db.loginAttempts[b].attempts || 0) + 1;
    if (db.loginAttempts[b].attempts >= MAX_ATTEMPTS) db.loginAttempts[b].lockUntil = Date.now() + LOCKOUT_MS;
    writeDb(db);
    return res.status(401).json({ error: 'Invalid badge or password' });
  }

  delete db.loginAttempts[b];
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = {
    badge: officer.badge,
    name: officer.name,
    rank: officer.rank,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000
  };
  writeDb(db);
  res.json({ token, officer });
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
  const token = req.headers.authorization.replace(/^Bearer\s+/i, '');
  const db = readDb();
  delete db.sessions[token];
  writeDb(db);
  res.json({ ok: true });
});

// ----- Citizen mobile: phone + OTP registration / login -----
const CITIZEN_OTP_TTL_MS = 5 * 60 * 1000;
const CITIZEN_OTP_MAX_ATTEMPTS = 5;
const CITIZEN_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeCitizenPhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('268') && digits.length === 11) digits = digits.slice(3);
  if (digits.length === 8) return '+268' + digits;
  if (digits.length === 9 && digits.startsWith('7')) return '+268' + digits;
  return null;
}

function citizenAuthMiddleware(req, res, next) {
  const token =
    req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const db = readDb();
  const sess = db.citizenSessions && db.citizenSessions[token];
  if (!sess || Date.now() > sess.expiresAt) {
    return res.status(401).json({ error: 'Session expired' });
  }
  const citizen = (db.citizens || []).find((c) => c.id === sess.citizenId);
  if (!citizen) return res.status(401).json({ error: 'Citizen not found' });
  req.citizen = citizen;
  req.citizenToken = token;
  next();
}

function issueCitizenSession(db, citizen) {
  const token = crypto.randomBytes(32).toString('hex');
  db.citizenSessions[token] = {
    citizenId: citizen.id,
    phone: citizen.phone,
    expiresAt: Date.now() + CITIZEN_SESSION_MS
  };
  writeDb(db);
  return token;
}

app.post('/api/citizen/otp/send', (req, res) => {
  const { phone, purpose, fullName } = req.body || {};
  const normalized = normalizeCitizenPhone(phone);
  if (!normalized) {
    return res.status(400).json({ error: 'Enter a valid Eswatini mobile number (8 digits)' });
  }
  const p = String(purpose || 'login').toLowerCase();
  if (p !== 'register' && p !== 'login') {
    return res.status(400).json({ error: 'Invalid purpose' });
  }

  const db = readDb();
  const existing = (db.citizens || []).find((c) => c.phone === normalized);

  if (p === 'register') {
    if (existing) {
      return res.status(409).json({ error: 'This number is already registered. Please sign in.' });
    }
    const name = String(fullName || '').trim();
    if (name.length < 2) {
      return res.status(400).json({ error: 'Full name is required for registration' });
    }
  } else if (!existing) {
    return res.status(404).json({ error: 'Number not registered. Create an account first.' });
  }

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  if (!db.citizenOtps) db.citizenOtps = {};
  db.citizenOtps[normalized] = {
    otp,
    purpose: p,
    fullName: p === 'register' ? String(fullName || '').trim() : null,
    expiresAt: Date.now() + CITIZEN_OTP_TTL_MS,
    attempts: 0
  };
  writeDb(db);

  console.log('[CITIZEN OTP] ' + normalized + ' → ' + otp + ' (' + p + ')');

  res.json({
    ok: true,
    message: 'Verification code sent to ' + normalized,
    expiresInSeconds: Math.floor(CITIZEN_OTP_TTL_MS / 1000),
    devOtp: otp
  });
});

app.post('/api/citizen/otp/verify', (req, res) => {
  const { phone, otp, purpose } = req.body || {};
  const normalized = normalizeCitizenPhone(phone);
  if (!normalized) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }
  const code = String(otp || '').trim();
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Enter the 6-digit verification code' });
  }

  const db = readDb();
  const pending = db.citizenOtps && db.citizenOtps[normalized];
  if (!pending) {
    return res.status(400).json({ error: 'No code pending. Request a new one.' });
  }
  if (Date.now() > pending.expiresAt) {
    delete db.citizenOtps[normalized];
    writeDb(db);
    return res.status(400).json({ error: 'Code expired. Request a new one.' });
  }

  pending.attempts = (pending.attempts || 0) + 1;
  if (pending.attempts > CITIZEN_OTP_MAX_ATTEMPTS) {
    delete db.citizenOtps[normalized];
    writeDb(db);
    return res.status(429).json({ error: 'Too many attempts. Request a new code.' });
  }

  if (pending.otp !== code) {
    writeDb(db);
    return res.status(401).json({ error: 'Incorrect code. Try again.' });
  }

  const p = String(purpose || pending.purpose || 'login').toLowerCase();
  delete db.citizenOtps[normalized];

  let citizen = (db.citizens || []).find((c) => c.phone === normalized);
  if (p === 'register') {
    if (citizen) {
      writeDb(db);
      return res.status(409).json({ error: 'Already registered. Please sign in.' });
    }
    citizen = {
      id: 'CIT-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
      phone: normalized,
      fullName: pending.fullName || 'Citizen',
      registeredAt: new Date().toISOString(),
      verified: true
    };
    if (!Array.isArray(db.citizens)) db.citizens = [];
    db.citizens.unshift(citizen);
  } else if (!citizen) {
    writeDb(db);
    return res.status(404).json({ error: 'Number not registered.' });
  }

  const token = issueCitizenSession(db, citizen);
  res.json({
    token,
    citizen: {
      id: citizen.id,
      phone: citizen.phone,
      fullName: citizen.fullName,
      registeredAt: citizen.registeredAt
    }
  });
});

app.get('/api/citizen/me', citizenAuthMiddleware, (req, res) => {
  const c = req.citizen;
  res.json({
    id: c.id,
    phone: c.phone,
    fullName: c.fullName,
    registeredAt: c.registeredAt
  });
});

app.post('/api/citizen/logout', citizenAuthMiddleware, (req, res) => {
  const db = readDb();
  delete db.citizenSessions[req.citizenToken];
  writeDb(db);
  res.json({ ok: true });
});

app.post('/api/reports', uploadEvidence.array('evidence', 10), async (req, res) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    const result = await createCitizenReport(req.body || {}, files);
    res.status(201).json(result);
  } catch (err) {
    console.error('/api/reports error:', err);
    res.status(500).json({ error: 'Could not save report' });
  }
});

app.post('/api/reports/json', express.json({ limit: '25mb' }), async (req, res) => {
  try {
    const body = req.body || {};
    const files = [];
    const evidenceBase64 = body.evidenceBase64;
    if (evidenceBase64 && typeof evidenceBase64 === 'string') {
      const cleaned = evidenceBase64.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(cleaned, 'base64');
      if (buffer.length && buffer.length <= 20 * 1024 * 1024) {
        const mime = String(body.evidenceMimeType || 'image/jpeg');
        const ext = mime.includes('png')
          ? 'png'
          : mime.includes('mp4') || mime.includes('video')
            ? 'mp4'
            : 'jpg';
        const filename =
          Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '-evidence.' + ext;
        fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
        files.push({
          originalname: body.evidenceName || filename,
          filename,
          size: buffer.length,
          mimetype: mime,
        });
      }
    }
    const result = await createCitizenReport(body, files);
    res.status(201).json(result);
  } catch (err) {
    console.error('reports/json failed', err);
    res.status(500).json({ error: 'Could not save report' });
  }
});

app.post('/api/reports/:id/evidence', uploadEvidence.single('evidence'), (req, res) => {
  const { id } = req.params;
  const db = readDb();
  const report = db.reports.find((x) => x.id === id);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  if (!report.payload) report.payload = {};
  if (!Array.isArray(report.payload.evidenceFiles)) report.payload.evidenceFiles = [];
  report.payload.evidenceFiles.push({
    name: req.file.originalname || req.file.filename,
    storedName: req.file.filename,
    size: req.file.size || 0,
    type: req.file.mimetype || 'application/octet-stream',
    url: '/uploads/' + req.file.filename,
  });
  writeDb(db);
  res.json({ ok: true, id });
});

async function createCitizenReport(body, files) {
  const id = 'REP-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  console.error('🔴 [createCitizenReport] Started with ID:', id);
  const parseJsonField = function (v, fallback) {
    if (typeof v !== 'string') return v == null ? fallback : v;
    try {
      return JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  };
  const payload = { ...body };
  if (typeof payload.anonymous === 'string') {
    payload.anonymous = payload.anonymous === 'true';
  }
  if (typeof payload.location === 'string') payload.location = parseJsonField(payload.location, payload.location);
  if (typeof payload.deviceInfo === 'string') payload.deviceInfo = parseJsonField(payload.deviceInfo, {});
  
  let evidenceFiles = [];
  
  // Handle file uploads to Supabase Storage if available
  if (files.length && USE_SUPABASE) {
    for (const f of files) {
      try {
        const fileBuffer = fs.readFileSync(path.join(UPLOADS_DIR, f.filename));
        const supabasePath = `${id}/${f.filename}`;
        const uploadedPath = await uploadEvidenceToSupabase('evidence', supabasePath, fileBuffer, f.mimetype);
        if (uploadedPath) {
          evidenceFiles.push({
            name: f.originalname || f.filename,
            storedName: uploadedPath,
            size: f.size || 0,
            type: f.mimetype || 'application/octet-stream',
            url: getSupabaseStorageUrl('evidence', uploadedPath)
          });
        }
      } catch (err) {
        console.error('Error uploading evidence to Supabase:', err);
      }
    }
  }
  
  // Fall back to local files if Supabase upload failed or not available
  if (!evidenceFiles.length && files.length) {
    evidenceFiles = files.map((f) => ({
      name: f.originalname || f.filename,
      storedName: f.filename,
      size: f.size || 0,
      type: f.mimetype || 'application/octet-stream',
      url: '/uploads/' + f.filename
    }));
  } else if (typeof payload.evidenceFiles === 'string') {
    evidenceFiles = parseJsonField(payload.evidenceFiles, []);
  }
  
  if (evidenceFiles.length) {
    payload.evidenceFiles = evidenceFiles;
  }
  
  const report = {
    id,
    type: payload.type || 'unknown',
    status: 'new',
    timestamp: new Date().toISOString(),
    payload: payload
  };
  
  // Save to Supabase if available
  if (USE_SUPABASE) {
    console.error('🟡 [createCitizenReport] USE_SUPABASE=true, saving to database...');
    const supabaseReport = {
      id: report.id,
      type: report.type,
      status: report.status,
      timestamp: report.timestamp,
      payload: report.payload
    };
    const result = await createReportInSupabase(supabaseReport);
    console.error('🟡 [createCitizenReport] Supabase result:', result ? '✅ SAVED' : '❌ FAILED');
  } else {
    console.error('🔴 [createCitizenReport] USE_SUPABASE=false, local JSON only');
  }
  
  // Also save to local JSON for backup
  const db = readDb();
  db.reports.unshift(report);
  writeDb(db);
  
  return { id, report };
}

app.get('/api/reports', authMiddleware, async (req, res) => {
  try {
    let reports;
    
    // Try to fetch from Supabase first
    if (USE_SUPABASE) {
      reports = await fetchReportsFromSupabase();
    }
    
    // Fall back to local JSON if Supabase not available
    if (!reports) {
      const db = readDb();
      purgeExpiredRecords(db);
      reports = db.reports;
    }
    
    res.json(reports);
  } catch (err) {
    console.error('Error fetching reports:', err);
    // Fall back to local JSON on error
    const db = readDb();
    purgeExpiredRecords(db);
    res.json(db.reports);
  }
});

app.get('/api/settings', authMiddleware, (req, res) => {
  const db = readDb();
  res.json(normalizeSettings(db.settings));
});

app.patch('/api/settings', authMiddleware, (req, res) => {
  const body = req.body || {};
  const db = readDb();
  const next = normalizeSettings({
    ...db.settings,
    ...(body.reportRetentionDays !== undefined
      ? { reportRetentionDays: body.reportRetentionDays }
      : {}),
    ...(body.liveAlertRetentionDays !== undefined
      ? { liveAlertRetentionDays: body.liveAlertRetentionDays }
      : {}),
  });
  db.settings = next;
  writeDb(db);
  const purged = purgeExpiredRecords(db);
  res.json({
    settings: purged.settings,
    purged: purged.changed,
  });
});

app.patch('/api/reports/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  const db = readDb();
  const r = db.reports.find((x) => x.id === id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (status) {
    r.status = status;
    if (status === 'closed' || status === 'resolved') {
      r.closedAt = new Date().toISOString();
    }
  }
  writeDb(db);
  res.json(r);
});

app.get('/api/notices', (req, res) => {
  res.json(readDb().notices);
});

// ----- Citizen mobile: Get Help (panic button with audio) -----
function applyPanicToSession(db, body, audioFilename) {
  const lat = parseFloat(body.latitude);
  const lng = parseFloat(body.longitude);
  const existingId = body.sessionId;

  if (existingId) {
    const s = db.distressSessions.find((x) => x.id === existingId && x.status === 'active');
    if (s) {
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        s.lastLat = lat;
        s.lastLng = lng;
        s.lastAccuracy = body.accuracyMeters != null ? parseFloat(body.accuracyMeters) : s.lastAccuracy;
        s.lastPingAt = new Date().toISOString();
        s.path.push({
          lat,
          lng,
          accuracy: s.lastAccuracy,
          ts: s.lastPingAt,
        });
        if (s.path.length > 500) s.path = s.path.slice(-500);
      }
      if (audioFilename) s.audioUrl = '/uploads/' + audioFilename;
      s.source = body.source || s.source || 'panic_button';
      s.priority = normalizeDistressPriority(body.priority || s.priority, s.source);
      if (isFacataAlert(body, s.source)) {
        s.alertType = 'facata';
        s.callAnswered = true;
      }
      if (body.callerNumber) {
        s.callerNumber = String(body.callerNumber).trim();
      }
      writeDb(db);
      return {
        status: 200,
        payload: {
          ok: true,
          sessionId: existingId,
          message: isFacataAlert(body, s.source)
            ? 'Facata call alert received. Police communications has been notified.'
            : 'Get Help alert received. Police communications has been notified.',
        },
      };
    }
  }

  const id = 'DIST-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const source = body.source || 'panic_button';
  const facata = isFacataAlert(body, source);
  const session = {
    id,
    priority: normalizeDistressPriority(body.priority, source),
    source: facata ? 'facata_call' : source,
    alertType: facata ? 'facata' : null,
    callAnswered: facata ? true : false,
    callerNumber: body.callerNumber ? String(body.callerNumber).trim() : null,
    status: 'active',
    deviceInfo: { accuracyMeters: body.accuracyMeters || null },
    startedAt: body.timestamp || new Date().toISOString(),
    lastPingAt: new Date().toISOString(),
    lastLat: Number.isFinite(lat) ? lat : null,
    lastLng: Number.isFinite(lng) ? lng : null,
    lastAccuracy: body.accuracyMeters != null ? parseFloat(body.accuracyMeters) : null,
    audioUrl: audioFilename ? '/uploads/' + audioFilename : null,
    path: []
  };
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    session.path.push({
      lat,
      lng,
      accuracy: session.lastAccuracy,
      ts: session.lastPingAt
    });
  }
  db.distressSessions.unshift(session);
  writeDb(db);
  return {
    status: 201,
    payload: {
      ok: true,
      sessionId: id,
      message: facata
        ? 'Facata call alert received. Police communications has been notified.'
        : 'Get Help alert received. Police communications has been notified.'
    }
  };
}

app.post('/api/citizen/emergency/panic', uploadAudio.single('audio'), (req, res) => {
  const db = readDb();
  const result = applyPanicToSession(db, req.body || {}, req.file ? req.file.filename : null);
  res.status(result.status).json(result.payload);
});

/** JSON + base64 audio — reliable fallback when multipart upload fails on some phone networks. */
app.post('/api/citizen/emergency/panic-json', express.json({ limit: '25mb' }), (req, res) => {
  try {
    const body = req.body || {};
    const audioBase64 = body.audioBase64;
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      return res.status(400).json({ error: 'Missing audio recording' });
    }

    const cleaned = audioBase64.replace(/^data:audio\/[^;]+;base64,/, '');
    const buffer = Buffer.from(cleaned, 'base64');
    if (!buffer.length) {
      return res.status(400).json({ error: 'Audio recording was empty' });
    }
    if (buffer.length > 20 * 1024 * 1024) {
      return res.status(413).json({ error: 'Audio recording is too large' });
    }

    const ext = (body.mimeType || '').includes('wav') ? 'wav' : 'm4a';
    const filename =
      Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '-panic.' + ext;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);

    const db = readDb();
    const result = applyPanicToSession(db, body, filename);
    res.status(result.status).json(result.payload);
  } catch (err) {
    console.error('panic-json failed', err);
    res.status(500).json({ error: 'Could not save Get Help audio' });
  }
});

// ----- Live distress / Get Help (legacy web citizen) -----
app.post('/api/distress/start', (req, res) => {
  const body = req.body || {};
  const id = 'DIST-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const lat = parseFloat(body.lat);
  const lng = parseFloat(body.lng);
  const source = body.source || 'web';
  const facata = isFacataAlert(body, source);
  const session = {
    id,
    priority: normalizeDistressPriority(body.priority, source),
    source: facata ? 'facata_call' : source,
    alertType: facata ? 'facata' : null,
    callAnswered: facata ? true : !!body.callAnswered,
    callerNumber: body.callerNumber ? String(body.callerNumber).trim() : null,
    status: 'active',
    deviceInfo: body.deviceInfo || {},
    startedAt: new Date().toISOString(),
    lastPingAt: new Date().toISOString(),
    lastLat: Number.isFinite(lat) ? lat : null,
    lastLng: Number.isFinite(lng) ? lng : null,
    lastAccuracy: body.accuracy != null ? parseFloat(body.accuracy) : null,
    path: []
  };
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    session.path.push({
      lat,
      lng,
      accuracy: body.accuracy,
      ts: new Date().toISOString()
    });
  }
  const db = readDb();
  db.distressSessions.unshift(session);
  writeDb(db);
  res.status(201).json({
    sessionId: id,
    message: 'Police can now track this device. Keep app open when safe.'
  });
});

app.post('/api/distress/:id/ping', (req, res) => {
  const { id } = req.params;
  const { lat, lng, accuracy } = req.body || {};
  const la = parseFloat(lat);
  const ln = parseFloat(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) {
    return res.status(400).json({ error: 'lat/lng required' });
  }
  const db = readDb();
  const s = db.distressSessions.find((x) => x.id === id && x.status === 'active');
  if (!s) return res.status(404).json({ error: 'Session not active' });
  s.lastLat = la;
  s.lastLng = ln;
  s.lastAccuracy = accuracy != null ? parseFloat(accuracy) : null;
  s.lastPingAt = new Date().toISOString();
  s.path.push({ lat: la, lng: ln, accuracy: s.lastAccuracy, ts: s.lastPingAt });
  if (s.path.length > 500) s.path = s.path.slice(-500);
  writeDb(db);
  res.json({ ok: true });
});

app.get('/api/distress/active', authMiddleware, (req, res) => {
  const db = readDb();
  if (!Array.isArray(db.distressSessions)) db.distressSessions = [];
  purgeExpiredRecords(db);
  res.json(listOpenDistressSessions(db));
});

/** Debug: same data without auth — prototype only; remove in production */
app.get('/api/distress/active-debug', (req, res) => {
  const db = readDb();
  if (!Array.isArray(db.distressSessions)) db.distressSessions = [];
  const active = listOpenDistressSessions(db);
  res.json({
    count: active.length,
    ids: active.map((x) => x.id).slice(0, 8),
    hint: 'Phone must use same PC API URL (http://PC-IP:3000) via EXPO_PUBLIC_API_URL. If count>0 but admin empty → log in admin + refresh.'
  });
});

app.post('/api/distress/:id/end', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  const s = db.distressSessions.find((x) => x.id === id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  s.status = 'ended_by_citizen';
  s.endedAt = new Date().toISOString();
  writeDb(db);
  res.json({ ok: true });
});

app.get('/api/distress/:id/status', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  const s = db.distressSessions.find((x) => x.id === id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json({
    id: s.id,
    status: s.status,
    assignedOfficer: s.assignedOfficer || null,
    assignment: s.assignment || null,
    lastPingAt: s.lastPingAt || null
  });
});

app.patch('/api/distress/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { status, assignment } = req.body || {};
  const db = readDb();
  const s = db.distressSessions.find((x) => x.id === id);
  if (!s) return res.status(404).json({ error: 'Not found' });

  if (assignment && typeof assignment === 'object') {
    const name = String(assignment.name || '').trim();
    const badge = String(assignment.badge || '').trim();
    if (name || badge) {
      s.assignedOfficer = {
        id: String(assignment.id || ''),
        name: name || 'Assigned Officer',
        badge: badge || '',
        unit: String(assignment.unit || ''),
        phone: String(assignment.phone || '')
      };
      s.assignment = {
        assignedAt: new Date().toISOString(),
        assignedBy: req.officer ? req.officer.badge : 'dispatch',
        note: String(assignment.note || '')
      };
    }
  }

  if (status === 'resolved') {
    s.status = 'resolved';
    s.resolvedAt = new Date().toISOString();
  } else if (status === 'acknowledged') {
    s.status = 'acknowledged';
    s.acknowledgedAt = new Date().toISOString();
    if (req.officer) {
      s.acknowledgedBy = req.officer.badge;
    }
  }
  writeDb(db);
  res.json(s);
});

app.post('/api/notices/upload', authMiddleware, uploadEvidence.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.status(201).json({
    url: '/uploads/' + req.file.filename,
    mimeType: req.file.mimetype,
  });
});

app.post('/api/notices', authMiddleware, (req, res) => {
  const body = req.body || {};
  const { title, message, type, location, urgent, actionLabel } = body;
  if (!title || (!message && !body.attachmentUrl)) {
    return res.status(400).json({ error: 'Title and message or attachment required' });
  }
  const category = body.category || type || 'national';
  const scope = body.scope || (location === 'national' || !location ? 'national' : 'regional');
  const urgency = body.urgency || (urgent ? 'emergency' : 'advisory');
  const notice = {
    id: 'NOTICE-' + Date.now(),
    title: urgency === 'emergency' && !String(title).startsWith('🚨') ? '🚨 ' + title : title,
    message: message || 'See attached notice.',
    category,
    type: category,
    scope,
    region: scope === 'regional' ? (body.region || (location !== 'national' ? location : undefined)) : undefined,
    location: scope === 'national' ? 'national' : (body.region || location || 'regional'),
    urgency,
    urgent: urgency === 'emergency' || !!urgent,
    verified: body.verified !== false,
    reference: body.reference || null,
    expiresAt: body.expiresAt || null,
    acknowledgeable: !!body.acknowledgeable,
    attachmentUrl: body.attachmentUrl || null,
    actionLabel: actionLabel || null,
    timestamp: new Date().toISOString(),
  };
  const db = readDb();
  db.notices.unshift(notice);
  writeDb(db);
  res.status(201).json(notice);
});

const commsAdminDir = path.join(__dirname, 'police-admin', 'dist');

app.get('/communications-admin', (req, res) => res.redirect(302, '/communications/'));
if (fs.existsSync(commsAdminDir)) {
  app.use('/communications', express.static(commsAdminDir));
  app.get('/communications/*', (req, res) => {
    res.sendFile(path.join(commsAdminDir, 'index.html'));
  });
}

app.get('/', (req, res) => {
  if (fs.existsSync(commsAdminDir)) {
    return res.redirect(302, '/communications/');
  }
  res.type('html').send(
    '<!doctype html><html><body style="font-family:sans-serif;padding:2rem">' +
      '<h1>Eswatini Police API</h1>' +
      '<p>Shared API is running on port ' + PORT + '.</p>' +
      '<ul>' +
      '<li>Citizen app: <code>citizen-mobile/</code> (Expo)</li>' +
      '<li>Admin dashboard: <code>npm run admin:dev</code> → http://localhost:5174</li>' +
      '<li>Or build admin: <code>npm run admin:build</code> then open /communications/</li>' +
      '</ul></body></html>'
  );
});

ensureDb();
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('API: http://localhost:' + PORT + '/');
  console.log('Citizen app: run Expo in citizen-mobile/ (points EXPO_PUBLIC_API_URL at this API)');
  console.log('Admin dashboard (dev): http://localhost:5174 — username MELU101 / Melu123!');
  if (fs.existsSync(commsAdminDir)) {
    console.log('Admin (built): http://localhost:' + PORT + '/communications/');
  } else {
    console.log('Admin (built): run "npm run admin:build" then restart — or "npm run admin:dev"');
  }

  // Auto-remove expired reports / closed live alerts on a schedule.
  try {
    purgeExpiredRecords(readDb());
  } catch (err) {
    console.error('Initial retention purge failed', err);
  }
  setInterval(() => {
    try {
      purgeExpiredRecords(readDb());
    } catch (err) {
      console.error('Retention purge failed', err);
    }
  }, 60 * 60 * 1000);
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error('Port ' + PORT + ' is already in use.');
    console.error('Close the other server process or run with a different port (e.g. set PORT=3001).');
    process.exit(1);
    return;
  }
  throw err;
});
