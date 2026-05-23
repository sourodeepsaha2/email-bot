const fs   = require("fs");
const FILE = "./emailStore.json";

/* ─────────────────────────────────────────
   EMAIL STORE
   Key: email normalized → user_gmail_com
   Atomic write: write to temp → rename
   Prevents corruption on crash mid-write
───────────────────────────────────────── */

function normalizeEmail(email) {
  return String(email || "").toLowerCase().trim();
}

function toKey(email) {
  return normalizeEmail(email).replace(/[@.]/g, "_");
}

// In-memory cache to reduce disk reads
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 2000; // 2 seconds

function load() {
  const now = Date.now();
  if (_cache && (now - _cacheTime) < CACHE_TTL) return _cache;

  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, "{}");
    _cache = {};
    _cacheTime = now;
    return {};
  }
  try {
    _cache = JSON.parse(fs.readFileSync(FILE));
    _cacheTime = now;
    return _cache;
  } catch (_) {
    return _cache || {};
  }
}

// Atomic write — write to temp file then rename
// Prevents corruption if process crashes mid-write
function save(data) {
  const tmp = FILE + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, FILE);
    _cache = data;
    _cacheTime = Date.now();
  } catch (err) {
    console.error("emailStore save error:", err.message);
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

function getStore()           { return load(); }
function setUser(key, data)   { const s = load(); s[key] = data; save(s); }
function deleteUser(key)      { const s = load(); delete s[key]; save(s); }
function findUserByEmail(email) {
  const key = toKey(email);
  return load()[key] ? key : null;
}

function updateUser(key, data) {
  const s = load();
  s[key]  = { ...s[key], ...data };
  save(s);
}

function addUser(email) {
  const key = toKey(email);
  const s   = load();
  if (!s[key]) {
    s[key] = { email, session: 1, lastSent: Date.now(), optOut: false };
    save(s);
  }
}

module.exports = {
  getStore, setUser, updateUser,
  deleteUser, addUser, toKey,
  normalizeEmail, findUserByEmail
};
