require("dotenv").config();

const nodemailer = require("nodemailer");
const crypto     = require("crypto");
const fs         = require("fs");

/* ═══════════════════════════════════════════════════════════
   DAILY EMAIL LIMIT
   Gmail free = 500/day — stay safely under
═══════════════════════════════════════════════════════════ */

const DAILY_LIMIT = 490;
const LIMIT_FILE  = "./dailyLimit.json";

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function readLimitData() {
  try {
    if (!fs.existsSync(LIMIT_FILE)) return { date: getTodayDate(), count: 0 };
    return JSON.parse(fs.readFileSync(LIMIT_FILE));
  } catch (_) {
    return { date: getTodayDate(), count: 0 };
  }
}

function saveLimitData(data) {
  const tmp = LIMIT_FILE + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, LIMIT_FILE);
  } catch (_) {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

function isDailyLimitReached() {
  const data = readLimitData();
  if (data.date !== getTodayDate()) return false;
  return data.count >= DAILY_LIMIT;
}

function incrementDailyCount() {
  const data  = readLimitData();
  const today = getTodayDate();
  if (data.date !== today) {
    saveLimitData({ date: today, count: 1 });
  } else {
    saveLimitData({ date: today, count: data.count + 1 });
  }
}

function getDailyCount() {
  const data  = readLimitData();
  if (data.date !== getTodayDate()) return 0;
  return data.count;
}

/* ═══════════════════════════════════════════════════════════
   EMAIL WARM-UP LOGIC
   New account → start low, increase gradually
   Prevents Gmail from flagging as spam
═══════════════════════════════════════════════════════════ */

const WARMUP_FILE = "./warmup.json";

// Day 1: 20, Day 2: 40, Day 3: 80, Day 4: 150, Day 5: 250, Day 6+: 490
const WARMUP_SCHEDULE = [20, 40, 80, 150, 250, 490];

function getWarmupData() {
  try {
    if (!fs.existsSync(WARMUP_FILE)) {
      const data = { startDate: getTodayDate(), day: 1 };
      fs.writeFileSync(WARMUP_FILE, JSON.stringify(data, null, 2));
      return data;
    }
    return JSON.parse(fs.readFileSync(WARMUP_FILE));
  } catch (_) {
    return { startDate: getTodayDate(), day: 1 };
  }
}

function getWarmupLimit() {
  const data  = getWarmupData();
  const start = new Date(data.startDate);
  const today = new Date(getTodayDate());
  const daysPassed = Math.floor((today - start) / (1000 * 60 * 60 * 24));
  const idx   = Math.min(daysPassed, WARMUP_SCHEDULE.length - 1);
  return WARMUP_SCHEDULE[idx];
}

function getEffectiveLimit() {
  return Math.min(DAILY_LIMIT, getWarmupLimit());
}

/* ═══════════════════════════════════════════════════════════
   PRODUCTION SMTP TRANSPORTER
═══════════════════════════════════════════════════════════ */

const transporter = nodemailer.createTransport({

  host  : process.env.SMTP_HOST || "smtp.gmail.com",
  port  : parseInt(process.env.SMTP_PORT || "587"),
  secure: false,

  auth: {
    type: "login",
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  },

  requireTLS: true,
  tls: {
    rejectUnauthorized: true,
    servername: "smtp.gmail.com",
    minVersion: "TLSv1.2"
  },

  connectionTimeout: 60000,
  greetingTimeout  : 30000,
  socketTimeout    : 300000,

  pool          : true,
  maxConnections: 2,
  maxMessages   : 50,
  rateDelta     : 2000,
  rateLimit     : 3,

  dkim: {
    domainName : process.env.DKIM_DOMAIN    || "chartersunion.com",
    keySelector: process.env.DKIM_SELECTOR  || "mail",
    privateKey : process.env.DKIM_PRIVATE_KEY,
    skipFields : "message-id:date",
    cacheDir   : false
  },

  disableFileAccess: true,
  disableUrlAccess : true,

  logger: process.env.NODE_ENV === "development",
  debug : process.env.NODE_ENV === "development"
});

transporter.on("idle",  () => {});
transporter.on("error", (err) => {
  console.error("📭 Transporter error:", err.code, err.message);
});

/* ═══════════════════════════════════════════════════════════
   CONFIG
═══════════════════════════════════════════════════════════ */

const FROM_NAME    = process.env.FROM_NAME    || "Charters Union Admissions";
const FROM_ADDRESS = process.env.FROM_ADDRESS || process.env.GMAIL_USER;
const DOMAIN       = (FROM_ADDRESS || "").split("@")[1] || "chartersunion.com";
const BOUNCE_ADDRESS = process.env.BOUNCE_ADDRESS || process.env.GMAIL_USER;

/* ═══════════════════════════════════════════════════════════
   SUBJECT ROTATION
═══════════════════════════════════════════════════════════ */

// Subject always comes from contentAgentEmail.generateSubject()
// passed as override — no rotation needed
function getNextSubject(override) {
  return override || "Admissions — Charters Union of Business";
}

/* ═══════════════════════════════════════════════════════════
   PREHEADER TEXT
   Shown after subject in Gmail inbox — improves open rate
═══════════════════════════════════════════════════════════ */

const PREHEADER_VARIANTS = [
  "Discover MBA, PGDM & Executive programs with global placements.",
  "Industry-led education with Harvard faculty & 95% placement rate.",
  "Join 1500+ recruiters — batch starting September 2026.",
  "Limited seats available — apply now for Charters Union programs.",
  "Global exposure in USA, Dubai, Singapore & more."
];

let preheaderIndex = 0;

function getNextPreheader() {
  const p = PREHEADER_VARIANTS[preheaderIndex % PREHEADER_VARIANTS.length];
  preheaderIndex++;
  return p;
}

function injectPreheader(html, preheaderText) {
  const preheader = `<div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheaderText}</div>`;
  return html.replace(/<body[^>]*>/, (match) => `${match}\n${preheader}`);
}

/* ═══════════════════════════════════════════════════════════
   INPUT SANITIZATION
   Prevent header injection attacks
═══════════════════════════════════════════════════════════ */

function sanitizeHeader(value) {
  if (!value) return "";
  return String(value)
    .replace(/[\r\n\t]/g, " ")  // Remove newlines — prevent header injection
    .replace(/[<>]/g, "")       // Remove angle brackets
    .trim()
    .slice(0, 500);              // Max length
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

/* ═══════════════════════════════════════════════════════════
   RETRY LOGIC
═══════════════════════════════════════════════════════════ */

const RETRYABLE_CODES = ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EPROTOCOL"];
const MAX_RETRIES     = 3;
const RETRY_DELAY_MS  = 5000;

function isRetryable(err) {
  if (RETRYABLE_CODES.includes(err.code)) return true;
  // Only retry 5xx (server errors) — 4xx are permanent failures (bad address, rejected)
  if (err.responseCode >= 500) return true;
  return false;
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/* ═══════════════════════════════════════════════════════════
   SEND EMAIL
═══════════════════════════════════════════════════════════ */

async function sendEmail({ to, subject, html, text, inReplyTo, references, isReply = false }) {

  // Input validation
  if (!isValidEmail(to)) {
    console.error(`❌ Invalid email address: ${to}`);
    return { ok: false, error: "INVALID_EMAIL" };
  }

  // Sanitize inputs
  const safeTo      = sanitizeHeader(to);
  const safeSubject = sanitizeHeader(subject || "");

  // Warm-up aware daily limit check
  // Replies are exempt — user already replied, we must respond
  const effectiveLimit = getEffectiveLimit();
  if (!isReply && getDailyCount() >= effectiveLimit) {
    console.log(`⛔ Daily limit reached (${getDailyCount()}/${effectiveLimit}) — warmup day limit`);
    return { ok: false, error: "DAILY_LIMIT_REACHED" };
  }

  const msgId        = `<${Date.now()}.${crypto.randomUUID()}@${DOMAIN}>`;
  const finalSubject = getNextSubject(safeSubject);
  const preheader    = getNextPreheader();
  const finalHtml    = injectPreheader(html, preheader);

  const message = {
    from    : `"${FROM_NAME}" <${FROM_ADDRESS}>`,
    to      : safeTo,
    replyTo : process.env.GMAIL_USER,

    // SMTP Envelope — bounces go to BOUNCE_ADDRESS separately
    envelope: {
      from: `<${BOUNCE_ADDRESS}>`,
      to  : safeTo
    },

    ...(inReplyTo  && { inReplyTo }),
    ...(references && { references }),

    subject  : finalSubject,
    html     : finalHtml,
    text     : text || stripHtml(html),
    messageId: msgId,
    priority : "normal",

    disableFileAccess: true,
    disableUrlAccess : true,

    headers: {
      // RFC 2369 compliant — Gmail shows unsubscribe button automatically
      "List-Unsubscribe"     : `<${process.env.BASE_URL}/unsubscribe>, <mailto:${FROM_ADDRESS}?subject=unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      // list > bulk — spam filters trust more
      "Precedence"           : "list",
      "X-Mailer"             : false,
      "X-Priority"           : "3",         // Normal priority — compatible with all clients
      "X-Entity-Ref-ID"      : crypto.randomUUID() // Unique per email — prevents threading false positives
    }
  };

  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const info = await transporter.sendMail(message);

      if (info.rejected && info.rejected.length > 0) {
        console.warn("⚠️  Some recipients rejected:", info.rejected);
        info.rejectedErrors?.forEach(e => {
          console.warn(`   ${e.recipient}: ${e.message}`);
        });
      }

      console.log(`📤 Email sent: ${to} | msgId: ${info.messageId} | today: ${getDailyCount() + 1}/${effectiveLimit}`);
      incrementDailyCount();
      return { ok: true, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };

    } catch (err) {
      switch (err.code) {
        case "EAUTH":
        case "ENOAUTH":
          console.error(`❌ Auth failed [${err.code}]: Check GMAIL_USER and GMAIL_APP_PASSWORD`);
          return { ok: false, error: err.message, code: err.code };

        case "EENVELOPE":
          console.error(`❌ Invalid envelope [${err.code}]:`, err.rejected);
          return { ok: false, error: err.message, code: err.code };

        case "EMESSAGE":
          console.error(`❌ Message rejected [${err.code}]: ${err.message}`);
          return { ok: false, error: err.message, code: err.code };

        case "ETLS":
        case "EREQUIRETLS":
          console.error(`❌ TLS error [${err.code}]: ${err.message}`);
          return { ok: false, error: err.message, code: err.code };

        default:
          lastErr = err;
          if (isRetryable(err) && attempt < MAX_RETRIES) {
            console.warn(`⏳ Attempt ${attempt} failed [${err.code}] — retrying in ${(RETRY_DELAY_MS * attempt) / 1000}s...`);
            await wait(RETRY_DELAY_MS * attempt);
          } else {
            console.error(`❌ Email failed [${err.code || "UNKNOWN"}]: ${to} — ${err.message}`);
            if (err.responseCode) console.error(`   SMTP ${err.responseCode}: ${err.response}`);
          }
      }
    }
  }

  return { ok: false, error: lastErr?.message, code: lastErr?.code };
}

/* ═══════════════════════════════════════════════════════════
   VERIFY CONNECTION
═══════════════════════════════════════════════════════════ */

async function verifyConnection() {
  try {
    await transporter.verify();
    console.log(`✅ SMTP connection verified — Gmail ready | warmup limit today: ${getEffectiveLimit()}`);
    return true;
  } catch (err) {
    console.error(`⚠️  SMTP verify failed [${err.code}]: ${err.message}`);
    if (err.code === "EAUTH")       console.error("   → Check GMAIL_USER and GMAIL_APP_PASSWORD");
    if (err.code === "ECONNECTION") console.error("   → Check SMTP_HOST and SMTP_PORT");
    if (err.code === "ETLS")        console.error("   → TLS issue — check network or firewall");
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════
   STRIP HTML → plain text
═══════════════════════════════════════════════════════════ */

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi,      "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi,     "\n")
    .replace(/<[^>]+>/g,     "")
    .replace(/&nbsp;/g,      " ")
    .replace(/&amp;/g,       "&")
    .replace(/&lt;/g,        "<")
    .replace(/&gt;/g,        ">")
    .replace(/&bull;/g,      "•")
    .replace(/\n{3,}/g,      "\n\n")
    .trim();
}

/* ═══════════════════════════════════════════════════════════
   GRACEFUL SHUTDOWN
═══════════════════════════════════════════════════════════ */

function closeTransporter() {
  transporter.close();
  console.log("📭 SMTP pool closed");
}

process.on("SIGTERM", closeTransporter);
process.on("SIGINT",  closeTransporter);

module.exports = {
  sendEmail,
  verifyConnection,
  closeTransporter,
  isDailyLimitReached,
  getDailyCount,
  getEffectiveLimit
};