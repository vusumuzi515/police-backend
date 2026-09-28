/**
 * TECHLAW Police shared API with local and Supabase storage modes
 * Run: npm install && npm start  (from POLICE APP folder)
 * Citizen app: citizen-mobile/ (Expo) → EXPO_PUBLIC_API_URL → this server
 * Admin app:   police-admin/ (Vite) → http://localhost:5174 or /communications after build
 * Default admin login: username MELU101, password Melu123!
 * Database and evidence: local JSON/disk in LOCAL_STORAGE_ONLY mode; Supabase otherwise
 */
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const LOCAL_STORAGE_ONLY = !process.env.NETLIFY && process.env.LOCAL_STORAGE_ONLY === 'true';
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'prototype-db.json');
const IS_NETLIFY = Boolean(process.env.NETLIFY);
const UPLOADS_DIR = process.env.UPLOADS_DIR || (IS_NETLIFY
  ? path.join(os.tmpdir(), 'police-uploads')
  : path.join(__dirname, 'uploads'));
const NETLIFY_STATE_ID = 'main';
let netlifyDbState = null;
let netlifyDbDirty = false;

// Supabase client
const SUPABASE_URL = LOCAL_STORAGE_ONLY ? '' : process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_SERVICE_KEY = LOCAL_STORAGE_ONLY ? '' : process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_PUBLISHABLE_KEY = LOCAL_STORAGE_ONLY ? '' : process.env.SUPABASE_PUBLISHABLE_KEY || '';
const supabase = !LOCAL_STORAGE_ONLY && SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

const USE_SUPABASE = supabase !== null;

// Debug: Log Supabase configuration on startup
console.log('=== SUPABASE CONFIGURATION ===');
console.log('LOCAL_STORAGE_ONLY:', LOCAL_STORAGE_ONLY);
console.log('SUPABASE_URL:', SUPABASE_URL ? 'SET' : 'NOT SET');
console.log('SUPABASE_SERVICE_KEY:', SUPABASE_SERVICE_KEY ? 'SET' : 'NOT SET');
console.log('USE_SUPABASE (client initialized):', USE_SUPABASE);
console.log('==============================');

const app = express();
app.use(cors());
// Netlify Functions have a smaller request payload limit than the long-running server.
app.use(express.json({ limit: IS_NETLIFY ? '4mb' : '100mb' }));
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

function initialDbState() {
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = crypto.pbkdf2Sync('Melu123!', salt, 100000, 32, 'sha256').toString('hex');
  return {
    officers: [{ badge: 'MELU101', name: 'Command Center Admin', rank: 'Command Center Admin', salt, passwordHash }],
    reports: [],
    notices: [],
    distressSessions: [],
    loginAttempts: {},
    sessions: {},
    citizens: [],
    citizenOtps: {},
    citizenSessions: {},
    reportUploadIntents: {},
    distressUploadIntents: {},
    settings: normalizeSettings(null),
  };
}

async function acquireNetlifyStateLock(owner) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const { data, error } = await supabase.rpc('police_app_state_acquire_lock', {
      p_owner: owner,
      p_ttl_seconds: 45,
    });
    if (error) throw error;
    if (data === true) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for the Supabase app-state lock');
}

async function releaseNetlifyStateLock(owner) {
  const { error } = await supabase.rpc('police_app_state_release_lock', { p_owner: owner });
  if (error) throw error;
}

app.use('/api', async (req, res, next) => {
  if (!IS_NETLIFY) return next();
  if (!USE_SUPABASE) return res.status(503).json({ error: 'Supabase backend is not configured' });

  const owner = crypto.randomUUID();
  try {
    await acquireNetlifyStateLock(owner);
    let { data, error } = await supabase
      .from('police_app_state')
      .select('state')
      .eq('id', NETLIFY_STATE_ID)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const inserted = await supabase
        .from('police_app_state')
        .insert({ id: NETLIFY_STATE_ID, state: initialDbState() })
        .select('state')
        .single();
      if (inserted.error) throw inserted.error;
      data = inserted.data;
    }

    netlifyDbState = data.state && Object.keys(data.state).length ? data.state : initialDbState();
    netlifyDbDirty = !data.state || !Object.keys(data.state).length;
    netlifyDbState.reports ||= [];
    netlifyDbState.notices ||= [];
    netlifyDbState.distressSessions ||= [];
    if (!Array.isArray(netlifyDbState.officers) || !netlifyDbState.officers.length) {
      netlifyDbState.officers = initialDbState().officers;
      netlifyDbDirty = true;
    }
    netlifyDbState.loginAttempts ||= {};
    netlifyDbState.sessions ||= {};
    netlifyDbState.citizens ||= [];
    netlifyDbState.citizenOtps ||= {};
    netlifyDbState.citizenSessions ||= {};
    netlifyDbState.reportUploadIntents ||= {};
    netlifyDbState.distressUploadIntents ||= {};
    netlifyDbState.settings = normalizeSettings(netlifyDbState.settings);
    for (const intents of [netlifyDbState.reportUploadIntents, netlifyDbState.distressUploadIntents]) {
      for (const [intentId, intent] of Object.entries(intents)) {
        if (!intent || intent.expiresAt <= Date.now()) {
          delete intents[intentId];
          netlifyDbDirty = true;
        }
      }
    }
    netlifyDbDirty = netlifyDbDirty || !data.state?.settings;

    const originalEnd = res.end.bind(res);
    let ended = false;
    res.end = (...args) => {
      if (ended) return res;
      ended = true;
      Promise.resolve()
        .then(async () => {
          if (netlifyDbDirty) {
            const saved = await supabase
              .from('police_app_state')
              .update({ state: netlifyDbState, updated_at: new Date().toISOString() })
              .eq('id', NETLIFY_STATE_ID)
              .eq('lock_owner', owner)
              .select('id')
              .maybeSingle();
            if (saved.error || !saved.data) throw saved.error || new Error('Lost Supabase state lock');
          }
          await releaseNetlifyStateLock(owner);
          originalEnd(...args);
        })
        .catch(async (saveError) => {
          console.error('Netlify Supabase state persistence failed:', saveError);
          try { await releaseNetlifyStateLock(owner); } catch (releaseError) {
            console.error('Could not release Supabase app-state lock:', releaseError);
          }
          if (!res.headersSent) {
            res.statusCode = 503;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
          }
          originalEnd(JSON.stringify({ error: 'Could not persist application state' }));
        });
      return res;
    };
    next();
  } catch (error) {
    console.error('Could not load Netlify Supabase state:', error);
    try { await releaseNetlifyStateLock(owner); } catch { /* lock may not have been acquired */ }
    res.status(503).json({ error: 'Could not load application state from Supabase' });
  }
});

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
  limits: { fileSize: IS_NETLIFY ? 4 * 1024 * 1024 : 80 * 1024 * 1024 },
});
const uploadAudio = multer({
  storage: evidenceStorage,
  limits: { fileSize: IS_NETLIFY ? 4 * 1024 * 1024 : 80 * 1024 * 1024 },
});

function ensureDb() {
  if (IS_NETLIFY) return;
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
    if (!db.reportUploadIntents || typeof db.reportUploadIntents !== 'object') db.reportUploadIntents = {};
    if (!db.distressUploadIntents || typeof db.distressUploadIntents !== 'object') db.distressUploadIntents = {};
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
  if (IS_NETLIFY) {
    if (!netlifyDbState) throw new Error('Supabase app state was not loaded for this request');
    return netlifyDbState;
  }
  ensureDb();
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  if (!Array.isArray(db.distressSessions)) db.distressSessions = [];
  if (!Array.isArray(db.reports)) db.reports = [];
  if (!db.reportUploadIntents || typeof db.reportUploadIntents !== 'object') db.reportUploadIntents = {};
  if (!db.distressUploadIntents || typeof db.distressUploadIntents !== 'object') db.distressUploadIntents = {};
  db.settings = normalizeSettings(db.settings);
  return db;
}

function writeDb(db) {
  db.settings = normalizeSettings(db.settings);
  if (IS_NETLIFY) {
    netlifyDbState = db;
    netlifyDbDirty = true;
    return;
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

const DISTRESS_TABLE = 'distress_sessions';

function distressRow(session) {
  return {
    id: session.id,
    status: session.status,
    started_at: session.startedAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    payload: session,
  };
}

function distressSessionFromRow(row) {
  const payload = row && row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    id: row.id || payload.id,
    status: row.status || payload.status || 'active',
  };
}

async function fetchDistressSessionsFromSupabase() {
  if (!USE_SUPABASE) return null;
  const { data, error } = await supabase
    .from(DISTRESS_TABLE)
    .select('id,status,started_at,updated_at,payload')
    .order('started_at', { ascending: false });
  if (error) {
    console.error('Supabase fetch distress sessions error:', error);
    return null;
  }
  return (data || []).map(distressSessionFromRow);
}

async function saveDistressSessionToSupabase(session) {
  if (!USE_SUPABASE) return true;
  const { error } = await supabase.from(DISTRESS_TABLE).upsert(distressRow(session));
  if (error) {
    console.error('Supabase save distress session error:', error);
    return false;
  }
  return true;
}

async function deleteDistressSessionFromSupabase(id) {
  if (!USE_SUPABASE) return true;
  const { error } = await supabase.from(DISTRESS_TABLE).delete().eq('id', id);
  if (error) {
    console.error('Supabase delete distress session error:', error);
    return false;
  }
  return true;
}

async function loadDistressDb() {
  const db = readDb();
  const sessions = await fetchDistressSessionsFromSupabase();
  if (sessions) db.distressSessions = sessions;
  return db;
}

async function saveDistressDb(db) {
  let savedToSupabase = !USE_SUPABASE;
  if (USE_SUPABASE) {
    savedToSupabase = true;
    for (const session of db.distressSessions || []) {
      const saved = await saveDistressSessionToSupabase(session);
      if (!saved) savedToSupabase = false;
    }
  }
  // Keep a local fallback so an alert is not lost when Supabase is unavailable.
  writeDb(db);
  return savedToSupabase;
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
    const reports = result.data || [];
    for (const report of reports) {
      const files = report?.payload?.evidenceFiles;
      if (!Array.isArray(files)) continue;
      for (const file of files) {
        if (!file || !file.storedName) continue;
        try {
          const signed = await supabase.storage
            .from('evidence')
            .createSignedUrl(file.storedName, 60 * 60);
          if (!signed.error && signed.data?.signedUrl) file.url = signed.data.signedUrl;
        } catch (err) {
          console.error('Supabase evidence URL error:', err.message);
        }
      }
    }
    return reports;
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

async function updateReportInSupabase(report) {
  if (!USE_SUPABASE) return true;
  try {
    const { error } = await supabase
      .from('reports')
      .update({
        status: report.status,
        closedAt: report.closedAt || null,
        payload: report.payload || {},
      })
      .eq('id', report.id);
    if (error) {
      console.error('Supabase update report error:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Supabase update report exception:', err.message);
    return false;
  }
}

async function uploadEvidenceToSupabase(bucket, fileName, fileBuffer, mimeType) {
  if (!USE_SUPABASE) return null;
  try {
    const options = {
        contentType: mimeType,
        upsert: false
    };
    let { data, error } = await supabase.storage.from(bucket).upload(fileName, fileBuffer, options);
    if (error && /bucket|not found|does not exist/i.test(error.message || '')) {
      const created = await supabase.storage.createBucket(bucket, { public: true });
      if (!created.error || /already exists/i.test(created.error.message || '')) {
        ({ data, error } = await supabase.storage.from(bucket).upload(fileName, fileBuffer, options));
      }
    }
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

const MAX_DIRECT_STORAGE_UPLOAD_BYTES = 50 * 1024 * 1024;
const UPLOAD_INTENT_TTL_MS = 30 * 60 * 1000;
const ALLOWED_MEDIA_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic',
  'video/mp4', 'video/quicktime', 'video/webm',
  'audio/mp4', 'audio/m4a', 'audio/wav', 'audio/mpeg', 'audio/aac',
]);

function safeUploadName(value) {
  const name = path.basename(String(value || 'evidence')).replace(/[^a-zA-Z0-9._-]/g, '_');
  return name.slice(-120) || 'evidence';
}

function hashUploadToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

async function issueSignedStorageUpload(req, ownerId, kind, body, intent) {
  const mimeType = String(body.mimeType || '').toLowerCase().split(';')[0].trim();
  const size = Number(body.size);
  if (!ALLOWED_MEDIA_TYPES.has(mimeType)) {
    const error = new Error('Unsupported media type');
    error.status = 415;
    throw error;
  }
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_DIRECT_STORAGE_UPLOAD_BYTES) {
    const error = new Error('File size must be between 1 byte and 50 MB');
    error.status = 413;
    throw error;
  }
  if (intent.expiresAt <= Date.now()) {
    const error = new Error('Upload authorization expired');
    error.status = 410;
    throw error;
  }
  const issuedPaths = Object.keys(intent.issued || {});
  if (issuedPaths.length >= intent.maxFiles) {
    const error = new Error('Upload limit reached for this submission');
    error.status = 409;
    throw error;
  }

  const fileName = safeUploadName(body.fileName);
  const storagePath = `${kind}/${ownerId}/${crypto.randomUUID()}-${fileName}`;
  if (LOCAL_STORAGE_ONLY) {
    const token = crypto.randomBytes(32).toString('base64url');
    const host = req.get('host') || `localhost:${PORT}`;
    intent.issued ||= {};
    intent.issued[storagePath] = {
      mimeType,
      size,
      fileName,
      issuedAt: Date.now(),
      localTokenHash: hashUploadToken(token),
    };
    return {
      path: storagePath,
      token,
      url: `${req.protocol}://${host}/api/local-evidence-upload/${token}`,
      apiKey: 'local-storage',
      mimeType,
      maxBytes: MAX_DIRECT_STORAGE_UPLOAD_BYTES,
    };
  }
  if (!USE_SUPABASE || !SUPABASE_PUBLISHABLE_KEY) {
    const error = new Error('Supabase signed uploads are not configured');
    error.status = 503;
    throw error;
  }
  const { data, error } = await supabase.storage.from('evidence').createSignedUploadUrl(storagePath);
  if (error || !data?.signedUrl || !data?.token) {
    console.error('Could not create Supabase signed upload URL:', error);
    const uploadError = new Error('Could not authorize upload to Supabase Storage');
    uploadError.status = 503;
    throw uploadError;
  }
  intent.issued ||= {};
  intent.issued[storagePath] = { mimeType, size, issuedAt: Date.now() };
  return {
    path: storagePath,
    token: data.token,
    url: data.signedUrl,
    apiKey: SUPABASE_PUBLISHABLE_KEY,
    mimeType,
    maxBytes: MAX_DIRECT_STORAGE_UPLOAD_BYTES,
  };
}

async function confirmSignedStorageUpload(storagePath, intent) {
  const issued = intent.issued && intent.issued[storagePath];
  if (!issued || intent.expiresAt <= Date.now()) {
    const error = new Error('Upload authorization is invalid or expired');
    error.status = 403;
    throw error;
  }
  if (intent.completed?.[storagePath]) {
    const error = new Error('This upload has already been completed');
    error.status = 409;
    throw error;
  }
  if (LOCAL_STORAGE_ONLY) {
    const localFilename = issued.localFilename;
    const localPath = localFilename && path.join(UPLOADS_DIR, path.basename(localFilename));
    if (!localPath || !fs.existsSync(localPath)) {
      const missingError = new Error('Uploaded file was not found in local storage');
      missingError.status = 409;
      throw missingError;
    }
    const storedSize = fs.statSync(localPath).size;
    if (storedSize !== issued.size) {
      const invalidError = new Error('Uploaded file does not match its authorized size');
      invalidError.status = 422;
      throw invalidError;
    }
    intent.completed ||= {};
    intent.completed[storagePath] = true;
    return { ...issued, path: storagePath, localFilename };
  }
  const { data, error } = await supabase.storage.from('evidence').info(storagePath);
  if (error || !data) {
    const missingError = new Error('Uploaded file was not found in Supabase Storage');
    missingError.status = 409;
    throw missingError;
  }
  const storedSize = Number(data.size ?? data.metadata?.size);
  const storedMimeType = String(data.metadata?.mimetype || data.metadata?.contentType || data.contentType || '').toLowerCase();
  if (storedSize !== issued.size || (storedMimeType && storedMimeType !== issued.mimeType)) {
    const invalidError = new Error('Uploaded file does not match its authorized size or media type');
    invalidError.status = 422;
    throw invalidError;
  }
  intent.completed ||= {};
  intent.completed[storagePath] = true;
  return { ...issued, path: storagePath };
}

app.put(
  '/api/local-evidence-upload/:token',
  express.raw({ type: '*/*', limit: `${MAX_DIRECT_STORAGE_UPLOAD_BYTES}b` }),
  (req, res) => {
    if (!LOCAL_STORAGE_ONLY) return res.sendStatus(404);
    const content = req.body;
    if (!Buffer.isBuffer(content) || content.length === 0) {
      return res.status(400).json({ error: 'No evidence file uploaded' });
    }

    const state = readDb();
    const tokenHash = hashUploadToken(req.params.token);
    let intent;
    let issued;
    for (const intentGroup of ['reportUploadIntents', 'distressUploadIntents']) {
      for (const candidate of Object.values(state[intentGroup] || {})) {
        const entry = Object.entries(candidate.issued || {}).find(
          ([, upload]) => upload.localTokenHash === tokenHash,
        );
        if (entry) {
          intent = candidate;
          issued = entry[1];
          break;
        }
      }
      if (issued) break;
    }
    if (!intent || !issued) return res.status(403).json({ error: 'Invalid upload authorization' });
    if (intent.expiresAt <= Date.now()) return res.status(410).json({ error: 'Upload authorization expired' });
    if (issued.localFilename) return res.status(409).json({ error: 'This upload has already been received' });

    const mimeType = String(req.get('content-type') || '').toLowerCase().split(';')[0].trim();
    if (content.length !== issued.size || mimeType !== issued.mimeType) {
      return res.status(422).json({ error: 'Uploaded file does not match its authorized size or media type' });
    }

    const localFilename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeUploadName(issued.fileName)}`;
    try {
      fs.writeFileSync(path.join(UPLOADS_DIR, localFilename), content, { flag: 'wx' });
      issued.localFilename = localFilename;
      writeDb(state);
      return res.status(204).end();
    } catch (error) {
      console.error('Could not save local evidence upload:', error);
      return res.status(500).json({ error: 'Could not save evidence to local storage' });
    }
  },
);

async function persistPanicAudio(sessionId, filename) {
  if (!filename) return false;
  const localPath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(localPath)) return false;

  let uploadedPath = null;
  try {
    if (USE_SUPABASE) {
      uploadedPath = await uploadEvidenceToSupabase(
        'evidence',
        `panic/${sessionId}/${filename}`,
        fs.readFileSync(localPath),
        filename.endsWith('.wav') ? 'audio/wav' : 'audio/mp4',
      );
    }
    if (IS_NETLIFY && !uploadedPath) {
      throw new Error('Could not persist Get Help audio to Supabase Storage');
    }
    const db = await loadDistressDb();
    const session = db.distressSessions.find((item) => item.id === sessionId);
    if (!session) return false;
    const audioUrl = uploadedPath
      ? getSupabaseStorageUrl('evidence', uploadedPath)
      : IS_NETLIFY
        ? null
        : `/uploads/${filename}`;
    const audioUploadedAt = new Date().toISOString();
    const audioRecords = Array.isArray(session.audioRecords) ? session.audioRecords : [];
    if (audioUrl && !audioRecords.some((record) => record && record.url === audioUrl)) {
      audioRecords.push({ url: audioUrl, uploadedAt: audioUploadedAt });
    }
    session.audioRecords = audioRecords;
    const audioUrls = Array.isArray(session.audioUrls) ? session.audioUrls : [];
    if (audioUrl && !audioUrls.includes(audioUrl)) audioUrls.push(audioUrl);
    session.audioUrls = audioUrls;
    session.audioUrl = audioUrl;
    session.audioUploadedAt = audioUploadedAt;
    session.audioStoragePath = uploadedPath || null;
    session.audioStorage = uploadedPath ? 'supabase' : IS_NETLIFY ? 'unavailable' : 'local-fallback';
    await saveDistressDb(db);
    return Boolean(uploadedPath);
  } catch (err) {
    console.error('Could not persist Get Help audio to Supabase Storage:', err);
    if (IS_NETLIFY) throw err;
    return false;
  }
}

function citizenIdentityFromBody(body) {
  const identity = {};
  for (const field of ['reporterName', 'nationalId', 'reporterPhone', 'reporterEmail', 'reporterAddress', 'reporterCity']) {
    const value = String(body[field] || '').trim();
    if (value) identity[field] = value;
  }
  return identity;
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
    const closedStatuses = new Set(['assigned', 'resolved', 'ended_by_citizen', 'expired']);
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
  const cutoff = Date.now() - STALE_PING_MS;
  return db.distressSessions
    .filter(
      (x) =>
        x &&
        (x.status === 'active' || x.status === 'acknowledged') &&
        !x.assignedOfficer &&
        Number.isFinite(new Date(x.startedAt).getTime()) &&
        new Date(x.startedAt).getTime() >= cutoff,
    )
    .sort((a, b) => {
      const pa = a.priority === 'high' ? 0 : 1;
      const pb = b.priority === 'high' ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
    });
}

function listRecentDistressSessions(db) {
  return db.distressSessions
    .filter((session) => session && (session.audioUrl || session.audioUrls?.length || session.status === 'active' || session.status === 'acknowledged'))
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 200);
}

async function withSignedDistressMedia(sessions) {
  if (!USE_SUPABASE) return sessions;
  return Promise.all(sessions.map(async (session) => {
    if (!session.audioStoragePath) return session;
    try {
      const { data, error } = await supabase.storage
        .from('evidence')
        .createSignedUrl(session.audioStoragePath, 60 * 60);
      if (error || !data?.signedUrl) throw error || new Error('No signed URL returned');
      const audioUrl = data.signedUrl;
      return {
        ...session,
        audioUrl,
        audioUrls: [audioUrl],
        audioRecords: [{ url: audioUrl, uploadedAt: session.audioUploadedAt || null }],
      };
    } catch (error) {
      console.error('Could not create Get Help audio read URL:', error);
      return { ...session, audioUrl: null, audioUrls: [], audioRecords: [] };
    }
  }));
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

app.post('/api/reports/metadata', async (req, res) => {
  try {
    const body = req.body || {};
    const directUploadCount = Number(body.directUploadCount);
    if (!Number.isInteger(directUploadCount) || directUploadCount < 1 || directUploadCount > 10) {
      return res.status(400).json({ error: 'A direct upload count between 1 and 10 is required' });
    }
    const { directUploadCount: _directUploadCount, ...reportBody } = body;
    const { report } = await createCitizenReport(reportBody, []);
    const uploadToken = crypto.randomBytes(32).toString('base64url');
    const db = readDb();
    db.reportUploadIntents[report.id] = {
      tokenHash: hashUploadToken(uploadToken),
      expiresAt: Date.now() + UPLOAD_INTENT_TTL_MS,
      maxFiles: directUploadCount,
      issued: {},
      completed: {},
    };
    writeDb(db);
    res.status(201).json({ id: report.id, uploadToken });
  } catch (err) {
    console.error('reports/metadata failed', err);
    res.status(503).json({ error: 'Could not create report for media upload' });
  }
});

app.post('/api/reports/:id/evidence/upload-ticket', async (req, res) => {
  try {
    const { id } = req.params;
    const db = readDb();
    const intent = db.reportUploadIntents[id];
    if (!intent || intent.tokenHash !== hashUploadToken(req.body?.uploadToken)) {
      return res.status(403).json({ error: 'Invalid upload authorization' });
    }
    const ticket = await issueSignedStorageUpload(req, id, 'reports', req.body || {}, intent);
    writeDb(db);
    res.json(ticket);
  } catch (err) {
    console.error('Could not issue report upload ticket:', err);
    res.status(err.status || 503).json({ error: err.message || 'Could not authorize report media upload' });
  }
});

app.post('/api/reports/:id/evidence/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const db = readDb();
    const report = db.reports.find((item) => item.id === id);
    const intent = db.reportUploadIntents[id];
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (!intent || intent.tokenHash !== hashUploadToken(req.body?.uploadToken)) {
      return res.status(403).json({ error: 'Invalid upload authorization' });
    }
    const file = await confirmSignedStorageUpload(String(req.body?.path || ''), intent);
    if (!report.payload) report.payload = {};
    if (!Array.isArray(report.payload.evidenceFiles)) report.payload.evidenceFiles = [];
    report.payload.evidenceFiles.push({
      name: safeUploadName(req.body?.fileName),
      storedName: file.localFilename || file.path,
      size: file.size,
      type: file.mimeType,
      url: file.localFilename ? `/uploads/${file.localFilename}` : getSupabaseStorageUrl('evidence', file.path),
    });
    writeDb(db);
    const saved = await updateReportInSupabase(report);
    if (!saved) return res.status(503).json({ error: 'Could not attach uploaded media to the report' });
    res.json({ ok: true, id });
  } catch (err) {
    console.error('Could not complete report media upload:', err);
    res.status(err.status || 503).json({ error: err.message || 'Could not complete report media upload' });
  }
});

app.post('/api/reports/:id/evidence', uploadEvidence.single('evidence'), async (req, res) => {
  const { id } = req.params;
  const db = readDb();
  const report = db.reports.find((x) => x.id === id);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let storedPath = null;
  if (IS_NETLIFY) {
    storedPath = await uploadEvidenceToSupabase(
      'evidence',
      `${id}/${req.file.filename}`,
      fs.readFileSync(req.file.path),
      req.file.mimetype,
    );
    if (!storedPath) return res.status(503).json({ error: 'Could not persist evidence to Supabase Storage' });
  }

  if (!report.payload) report.payload = {};
  if (!Array.isArray(report.payload.evidenceFiles)) report.payload.evidenceFiles = [];
  report.payload.evidenceFiles.push({
    name: req.file.originalname || req.file.filename,
    storedName: storedPath || req.file.filename,
    size: req.file.size || 0,
    type: req.file.mimetype || 'application/octet-stream',
    url: storedPath ? getSupabaseStorageUrl('evidence', storedPath) : '/uploads/' + req.file.filename,
  });
  writeDb(db);
  if (IS_NETLIFY) await updateReportInSupabase(report);
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
  const identity = payload.identity && typeof payload.identity === 'object' ? payload.identity : {};
  for (const field of ['reporterName', 'nationalId', 'reporterPhone', 'reporterEmail', 'reporterAddress', 'reporterCity']) {
    if (!payload[field] && identity[field]) payload[field] = String(identity[field]).trim();
  }
  if (typeof payload.anonymous === 'string') {
    payload.anonymous = payload.anonymous === 'true';
  }
  if (typeof payload.location === 'string') payload.location = parseJsonField(payload.location, payload.location);
  if (typeof payload.reporterLocationAtSubmission === 'string') {
    payload.reporterLocationAtSubmission = parseJsonField(payload.reporterLocationAtSubmission, undefined);
  }
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

  if (IS_NETLIFY && files.length && evidenceFiles.length !== files.length) {
    throw new Error('Could not durably upload all report evidence to Supabase Storage');
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
    if (IS_NETLIFY && !result) {
      throw new Error('Supabase did not confirm saving the citizen report');
    }
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

app.patch('/api/reports/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { status, assignment } = req.body || {};
  const db = readDb();
  const r = db.reports.find((x) => x.id === id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (status) {
    r.status = status;
    if (status === 'closed' || status === 'resolved') {
      r.closedAt = new Date().toISOString();
    }
  }
  if (assignment && typeof assignment === 'object') {
    const name = String(assignment.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Officer name is required' });
    r.assignedOfficer = {
      name,
      badge: String(assignment.badge || '').trim(),
      unit: String(assignment.unit || '').trim(),
    };
    r.assignedAt = new Date().toISOString();
    r.assignedBy = req.officer?.badge || 'communications';
    r.payload = {
      ...(r.payload || {}),
      assignedOfficer: r.assignedOfficer,
      assignedAt: r.assignedAt,
      assignedBy: r.assignedBy,
    };
    if (r.status === 'new') r.status = 'reviewing';
  }
  await updateReportInSupabase(r);
  writeDb(db);
  res.json(r);
});

app.get('/api/notices', (req, res) => {
  res.json(readDb().notices);
});

app.post('/api/notices', authMiddleware, (req, res) => {
  const body = req.body || {};
  const title = String(body.title || '').trim();
  const message = String(body.message || '').trim();
  if (!title) return res.status(400).json({ error: 'Notice title is required' });
  if (!message && !body.attachmentUrl) {
    return res.status(400).json({ error: 'Notice message or attachment is required' });
  }

  const now = new Date().toISOString();
  const notice = {
    id: 'NOTICE-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
    title,
    message,
    type: body.type || body.category || 'national',
    category: body.category || body.type || 'national',
    scope: body.scope === 'regional' ? 'regional' : 'national',
    region: body.region || undefined,
    location: body.location || undefined,
    urgency: body.urgency || (body.urgent ? 'emergency' : 'advisory'),
    urgent: Boolean(body.urgent),
    reference: body.reference || undefined,
    acknowledgeable: Boolean(body.acknowledgeable),
    attachmentUrl: body.attachmentUrl || undefined,
    timestamp: now,
    publishedAt: now,
    expiresAt: body.expiresAt || undefined,
    status: 'published',
    createdBy: req.officer?.badge || 'communications',
  };

  const db = readDb();
  if (!Array.isArray(db.notices)) db.notices = [];
  db.notices = [notice, ...db.notices];
  writeDb(db);
  res.status(201).json(notice);
});

// ----- Citizen mobile: Get Help (panic button with audio) -----
async function applyPanicToSession(db, body, audioFilename) {
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
      Object.assign(s, citizenIdentityFromBody(body));
      s.source = body.source || s.source || 'panic_button';
      s.priority = normalizeDistressPriority(body.priority || s.priority, s.source);
      if (isFacataAlert(body, s.source)) {
        s.alertType = 'facata';
        s.callAnswered = true;
      }
      if (body.callerNumber) {
        s.callerNumber = String(body.callerNumber).trim();
      }
      await saveDistressDb(db);
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
    audioUrl: null,
    audioUrls: [],
    audioUploadedAt: null,
    ...citizenIdentityFromBody(body),
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
  await saveDistressDb(db);
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

app.post('/api/citizen/emergency/panic', uploadAudio.single('audio'), async (req, res) => {
  try {
    const db = await loadDistressDb();
    const result = await applyPanicToSession(db, req.body || {}, req.file ? req.file.filename : null);
    if (req.file) await persistPanicAudio(result.payload.sessionId, req.file.filename);
    res.status(result.status).json(result.payload);
  } catch (err) {
    console.error('panic multipart failed', err);
    res.status(500).json({ error: 'Could not save Get Help audio' });
  }
});

/** JSON + base64 audio — reliable fallback when multipart upload fails on some phone networks. */
app.post('/api/citizen/emergency/panic-json', express.json({ limit: '25mb' }), async (req, res) => {
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

    const db = await loadDistressDb();
    const result = await applyPanicToSession(db, body, filename);
    await persistPanicAudio(result.payload.sessionId, filename);
    res.status(result.status).json(result.payload);
  } catch (err) {
    console.error('panic-json failed', err);
    res.status(500).json({ error: 'Could not save Get Help audio' });
  }
});

// ----- Live distress / Get Help (legacy web citizen) -----
app.post('/api/distress/start', async (req, res) => {
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
    ...citizenIdentityFromBody(body),
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
  const db = await loadDistressDb();
  db.distressSessions.unshift(session);
  await saveDistressDb(db);
  res.status(201).json({
    sessionId: id,
    message: 'Police can now track this device. Keep app open when safe.'
  });
});

app.post('/api/distress/:id/ping', async (req, res) => {
  const { id } = req.params;
  const { lat, lng, accuracy } = req.body || {};
  const la = parseFloat(lat);
  const ln = parseFloat(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) {
    return res.status(400).json({ error: 'lat/lng required' });
  }
  const db = await loadDistressDb();
  const s = db.distressSessions.find((x) => x.id === id && x.status === 'active');
  if (!s) return res.status(404).json({ error: 'Session not active' });
  s.lastLat = la;
  s.lastLng = ln;
  s.lastAccuracy = accuracy != null ? parseFloat(accuracy) : null;
  s.lastPingAt = new Date().toISOString();
  s.path.push({ lat: la, lng: ln, accuracy: s.lastAccuracy, ts: s.lastPingAt });
  if (s.path.length > 500) s.path = s.path.slice(-500);
  await saveDistressDb(db);
  res.json({ ok: true });
});

app.get('/api/distress/active', authMiddleware, async (req, res) => {
  const db = await loadDistressDb();
  if (!Array.isArray(db.distressSessions)) db.distressSessions = [];
  purgeExpiredRecords(db);
  res.json(await withSignedDistressMedia(listOpenDistressSessions(db)));
});

app.get('/api/distress/recent', authMiddleware, async (req, res) => {
  const db = await loadDistressDb();
  if (!Array.isArray(db.distressSessions)) db.distressSessions = [];
  purgeExpiredRecords(db);
  res.json(await withSignedDistressMedia(listRecentDistressSessions(db)));
});

/** Debug: same data without auth — prototype only; remove in production */
app.get('/api/distress/active-debug', async (req, res) => {
  const db = await loadDistressDb();
  if (!Array.isArray(db.distressSessions)) db.distressSessions = [];
  const active = listOpenDistressSessions(db);
  res.json({
    count: active.length,
    ids: active.map((x) => x.id).slice(0, 8),
    hint: 'Phone must use same PC API URL (http://PC-IP:3000) via EXPO_PUBLIC_API_URL. If count>0 but admin empty → log in admin + refresh.'
  });
});

app.post('/api/distress/:id/end', async (req, res) => {
  const { id } = req.params;
  const db = await loadDistressDb();
  const s = db.distressSessions.find((x) => x.id === id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  s.status = 'ended_by_citizen';
  s.endedAt = new Date().toISOString();
  await saveDistressDb(db);
  res.json({ ok: true });
});

app.get('/api/distress/:id/status', async (req, res) => {
  const { id } = req.params;
  const db = await loadDistressDb();
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

app.patch('/api/distress/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { status, assignment } = req.body || {};
  const db = await loadDistressDb();
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
      // Assigned incidents leave the unassigned live queue immediately.
      s.status = 'assigned';
      s.assignedAt = new Date().toISOString();
    }
  }

  if (status === 'resolved') {
    db.distressSessions = db.distressSessions.filter((session) => session.id !== id);
    await saveDistressDb(db);
    return res.json({ ok: true, deleted: true, id });
  } else if (status === 'acknowledged') {
    s.status = 'acknowledged';
    s.acknowledgedAt = new Date().toISOString();
    if (req.officer) {
      s.acknowledgedBy = req.officer.badge;
    }
  }
  await saveDistressDb(db);
  res.json(s);
});

app.post('/api/citizen/emergency/panic/start-upload', async (req, res) => {
  try {
    const body = req.body || {};
    const db = await loadDistressDb();
    const started = await applyPanicToSession(db, body, null);
    const sessionId = started.payload.sessionId;
    const uploadToken = crypto.randomBytes(32).toString('base64url');
    const state = readDb();
    state.distressUploadIntents[sessionId] = {
      tokenHash: hashUploadToken(uploadToken),
      expiresAt: Date.now() + UPLOAD_INTENT_TTL_MS,
      maxFiles: 1,
      issued: {},
      completed: {},
    };
    const ticket = await issueSignedStorageUpload(req, sessionId, 'panic', body, state.distressUploadIntents[sessionId]);
    writeDb(state);
    res.status(201).json({ ...ticket, sessionId, uploadToken, ok: true });
  } catch (err) {
    console.error('Could not start direct Get Help audio upload:', err);
    res.status(err.status || 503).json({ error: err.message || 'Could not start Get Help audio upload' });
  }
});

app.post('/api/citizen/emergency/panic/complete-upload', async (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = String(body.sessionId || '');
    const state = readDb();
    const intent = state.distressUploadIntents[sessionId];
    if (!intent || intent.tokenHash !== hashUploadToken(body.uploadToken)) {
      return res.status(403).json({ error: 'Invalid upload authorization' });
    }
    const file = await confirmSignedStorageUpload(String(body.path || ''), intent);
    const db = await loadDistressDb();
    const session = db.distressSessions.find((item) => item.id === sessionId);
    if (!session) return res.status(404).json({ error: 'Get Help session not found' });
    const audioUrl = file.localFilename
      ? `/uploads/${file.localFilename}`
      : getSupabaseStorageUrl('evidence', file.path);
    session.audioUrl = audioUrl;
    session.audioUrls = [audioUrl];
    session.audioRecords = [{ url: audioUrl, uploadedAt: new Date().toISOString() }];
    session.audioUploadedAt = new Date().toISOString();
    session.audioStoragePath = file.localFilename || file.path;
    session.audioStorage = file.localFilename ? 'local' : 'supabase';
    await saveDistressDb(db);
    delete state.distressUploadIntents[sessionId];
    writeDb(state);
    res.json({ ok: true, sessionId, audioUrl });
  } catch (err) {
    console.error('Could not complete direct Get Help audio upload:', err);
    res.status(err.status || 503).json({ error: err.message || 'Could not complete Get Help audio upload' });
  }
});

app.post('/api/notices/upload', authMiddleware, uploadEvidence.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (IS_NETLIFY) {
    const storedPath = await uploadEvidenceToSupabase(
      'evidence',
      `notices/${req.file.filename}`,
      fs.readFileSync(req.file.path),
      req.file.mimetype,
    );
    if (!storedPath) return res.status(503).json({ error: 'Could not persist attachment to Supabase Storage' });
    return res.status(201).json({
      url: getSupabaseStorageUrl('evidence', storedPath),
      mimeType: req.file.mimetype,
    });
  }
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

if (!process.env.NETLIFY) {
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
}

module.exports = app;
