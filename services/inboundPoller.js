require("dotenv").config();

const Imap             = require("imap");
const { simpleParser } = require("mailparser");
const replyEngine      = require("../emailReplyEngine");
const detectIntent     = require("./detectIntent");
const { buildReplySubject } = require("./emailSubject");
const findProgram      = require("./findProgram");
const store            = require("./emailStore");
const tracker          = require("./emailTracker");
const mailer           = require("../mailer");

/* ═══════════════════════════════════════════════════════════
   BOUNCE DETECTION
═══════════════════════════════════════════════════════════ */

const BOUNCE_SENDERS = [
  "mailer-daemon@",
  "postmaster@",
  "mail delivery subsystem",
  "delivery status notification",
  "undelivered mail returned"
];

const BOUNCE_SUBJECTS = [
  "delivery status notification",
  "undelivered mail",
  "returned mail",
  "message blocked",
  "mail delivery failed",
  "failure notice"
];

function isBounce(from, subject) {
  const f = (from    || "").toLowerCase();
  const s = (subject || "").toLowerCase();
  return BOUNCE_SENDERS.some(b => f.includes(b)) && BOUNCE_SUBJECTS.some(b => s.includes(b));
}

function extractBouncedEmail(text) {
  const match = text.match(/Final-Recipient:\s*rfc822;\s*([^\s]+)/i);
  if (match) return match[1].toLowerCase().trim();
  const match2 = text.match(/[\w.-]+@[\w.-]+\.[a-z]{2,}/gi);
  if (match2?.length) return match2[0].toLowerCase();
  return null;
}

/* ═══════════════════════════════════════════════════════════
   KNOWN LEAD FILTER
═══════════════════════════════════════════════════════════ */

function isKnownLead(from) {
  return !!store.getStore()[store.toKey(from)];
}

const LOW_SIGNAL_REPLIES = new Set([
  "ok",
  "okay",
  "ok thanks",
  "okay thanks",
  "thanks",
  "thank you",
  "thanks a lot",
  "got it",
  "noted",
  "sure",
  "fine",
  "alright",
  "all right",
  "cool",
  "great",
  "sounds good",
  "done"
]);

function isLowSignalReply(text, intent) {
  const clean = String(text || "").toLowerCase().replace(/[.!?]/g, "").trim();
  if (!clean) return true;
  if (LOW_SIGNAL_REPLIES.has(clean)) return true;
  if (intent === "OTHER" && clean.split(/\s+/).length <= 3) return true;
  return false;
}

/* ═══════════════════════════════════════════════════════════
   DUPLICATE GUARD
   Prevents processing same email twice on reconnect
═══════════════════════════════════════════════════════════ */

const processedIds = new Set();

function isDuplicate(msgId) {
  if (!msgId) return false;
  if (processedIds.has(msgId)) return true;
  processedIds.add(msgId);
  // Keep bounded — max 2000 entries
  if (processedIds.size > 2000) {
    processedIds.delete(processedIds.values().next().value);
  }
  return false;
}

/* ═══════════════════════════════════════════════════════════
   PROCESS ONE EMAIL
═══════════════════════════════════════════════════════════ */

async function processEmail(parsed) {
  try {
    const from    = String(parsed.from?.value?.[0]?.address || "").toLowerCase().trim();
    const subject = String(parsed.subject || "");
    const text    = String(parsed.text    || "").trim();
    const msgId   = String(parsed.messageId || "");

    if (!from || !from.includes("@")) return;

    // Skip own emails
    if (from === (process.env.GMAIL_USER || "").toLowerCase()) return;

    // Duplicate guard
    if (isDuplicate(msgId)) return;

    /* ── 1. BOUNCE ── */
    if (isBounce(from, subject)) {
      console.log("📛 Bounce detected from:", from);
      const bouncedEmail = extractBouncedEmail(text);
      if (bouncedEmail) {
        const key   = store.toKey(bouncedEmail);
        if (store.getStore()[key]) {
          store.updateUser(key, { optOut: true, bounced: true, bouncedAt: Date.now() });
          console.log(`🚫 Bounce marked: ${bouncedEmail}`);
        }
      }
      return;
    }

    /* ── 2. KNOWN LEAD FILTER ── */
    if (!isKnownLead(from)) return;

    const key  = store.toKey(from);
    const user = store.getStore()[key];

    if (user?.optOut) return;

    /* ── 3. CLEAN REPLY TEXT ── */
    const cleanText = text
      .split(/\nOn .+wrote:/s)[0]
      .split(/\n--\s*\n/)[0]
      .replace(/https?:\/\/\S+/g, "")
      .trim();

    if (!cleanText || cleanText.length < 2) return;

    console.log("\n📨 LEAD REPLY FROM:", from);
    console.log("Text:", cleanText.slice(0, 120));

    tracker.trackReply(key);
    store.updateUser(key, { lastInteraction: Date.now() });

    const matchedProgram = findProgram(cleanText);
    if (matchedProgram) {
      tracker.trackCourseView(key, matchedProgram.name);
      store.updateUser(key, {
        course: matchedProgram.name,
        courseId: matchedProgram.id,
        courseExplicit: true,
        lastInteraction: Date.now()
      });
    }

    /* ── 4. INTENT ── */
    let intent = "OTHER";
    try {
      intent = String(await detectIntent(cleanText) || "OTHER").toUpperCase();
    } catch (_) {}

    const lowSignalReply = isLowSignalReply(cleanText, intent);
    if (!lowSignalReply) {
      tracker.saveLastQuestion(key, cleanText.slice(0, 120));
    } else {
      console.log("Low-signal reply detected, keeping previous question context:", cleanText);
    }

    const effectiveIntent = lowSignalReply ? "IRRELEVANT" : intent;

    /* ── 5. REPLY ── */

    const leadName  = user?.name || "";
    const replyHtml = await replyEngine({ body: cleanText }, key, effectiveIntent, leadName);
    if (replyHtml) {
      const result = await mailer.sendEmail({
        to        : from,
        subject   : buildReplySubject(subject),
        html      : replyHtml,
        inReplyTo : user?.messageId || undefined,
        references: user?.messageId || undefined,
        isReply   : true
      });
      if (result.ok) console.log("✅ Reply sent to:", from);
      else console.log("⚠️ Reply failed:", result.error);
    }

  } catch (err) {
    console.log("processEmail error:", err.message);
  }
}

/* ═══════════════════════════════════════════════════════════
   FETCH UNSEEN EMAILS
═══════════════════════════════════════════════════════════ */

function fetchUnseen(imap) {
  return new Promise((resolve, reject) => {
    imap.search(["UNSEEN"], (err, results) => {
      if (err) return reject(err);
      if (!results?.length) return resolve();

      const fetch = imap.fetch(results, { bodies: "", markSeen: true });

      fetch.on("message", (msg) => {
        const chunks = [];
        msg.on("body", (stream) => {
          stream.on("data",  (chunk) => chunks.push(chunk));
          stream.on("end", async () => {
            try {
              const parsed = await simpleParser(Buffer.concat(chunks));
              await processEmail(parsed);
            } catch (e) {
              console.log("Parse error:", e.message);
            }
          });
        });
      });

      fetch.once("error", reject);
      fetch.once("end",   resolve);
    });
  });
}

/* ═══════════════════════════════════════════════════════════
   LONG-LIVED IMAP CONNECTION
   
   Old approach: connect → fetch → disconnect (every 30s)
   New approach: connect ONCE → stay connected → IDLE mode
                 Gmail pushes new mail notification instantly
                 No polling needed — real-time
   
   IMAP IDLE protocol:
   - Connection stays open permanently
   - Server sends "EXISTS" event when new email arrives
   - We fetch only when notified — no wasted connections
   - Reconnect automatically if connection drops
═══════════════════════════════════════════════════════════ */

let imapInstance   = null;
let isConnected    = false;
let isIdling       = false;
let reconnectTimer = null;
let reconnectDelay = 5000;   // Start at 5s, max 5min
let started        = false;

function createImapConfig() {
  return {
    user       : process.env.GMAIL_USER,
    password   : process.env.GMAIL_APP_PASSWORD,
    host       : "imap.gmail.com",
    port       : 993,
    tls        : true,
    tlsOptions : { rejectUnauthorized: false },
    connTimeout: 30000,
    authTimeout: 15000,
    keepalive  : {
      interval  : 10000,   // Send keepalive every 10s
      idleInterval: 300000, // Re-enter IDLE every 5min (Gmail requirement)
      forceNoop : true      // Force NOOP if IDLE not supported
    }
  };
}

function enterIdle(imap) {
  if (!isConnected || isIdling) return;
  try {
    imap.imap?.serverSupports("IDLE")
      ? imap._imap?.idle?.start?.()
      : null;
    isIdling = true;
  } catch (_) {}
}

function connect() {
  if (imapInstance) {
    try { imapInstance.destroy(); } catch (_) {}
    imapInstance = null;
  }

  isConnected = false;
  isIdling    = false;

  const imap = new Imap(createImapConfig());
  imapInstance = imap;

  /* ── READY ── */
  imap.once("ready", () => {
    isConnected    = true;
    reconnectDelay = 5000; // Reset backoff on success
    console.log("📬 IMAP connected — opening INBOX");

    imap.openBox("INBOX", false, async (err, box) => {
      if (err) {
        console.log("IMAP openBox error:", err.message);
        scheduleReconnect();
        return;
      }

      console.log(`📥 INBOX open | ${box.messages.unseen || 0} unseen`);

      // Fetch any unseen emails that arrived while we were disconnected
      try {
        await fetchUnseen(imap);
      } catch (e) {
        console.log("Initial fetch error:", e.message);
      }

      // Listen for new mail notifications (server pushes these)
      imap.on("mail", async (numNewMsgs) => {
        console.log(`📩 New mail arrived (${numNewMsgs}) — fetching`);
        isIdling = false;
        try {
          await fetchUnseen(imap);
        } catch (e) {
          console.log("New mail fetch error:", e.message);
        }
      });

      // Listen for flag changes (e.g. mark read)
      imap.on("update", () => { isIdling = false; });

      console.log("✅ IMAP long-lived connection ready — listening for new mail");
    });
  });

  /* ── ERROR ── */
  imap.on("error", (err) => {
    console.log("IMAP error:", err.message);
    isConnected = false;
    isIdling    = false;
    scheduleReconnect();
  });

  /* ── END / CLOSE ── */
  imap.once("end", () => {
    console.log("📭 IMAP connection ended");
    isConnected = false;
    isIdling    = false;
    scheduleReconnect();
  });

  imap.once("close", (hadError) => {
    if (hadError) {
      console.log("IMAP connection closed with error");
    }
    isConnected = false;
    isIdling    = false;
    scheduleReconnect();
  });

  imap.connect();
}

/* ── RECONNECT WITH EXPONENTIAL BACKOFF ── */
function scheduleReconnect() {
  if (reconnectTimer) return; // Already scheduled

  console.log(`🔄 IMAP reconnecting in ${reconnectDelay / 1000}s...`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
    // Exponential backoff — 5s → 10s → 20s → ... max 5min
    reconnectDelay = Math.min(reconnectDelay * 2, 300000);
  }, reconnectDelay);
}

/* ═══════════════════════════════════════════════════════════
   START
═══════════════════════════════════════════════════════════ */

function startInboundPoller() {
  if (started) return;
  started = true;
  console.log("📬 Gmail IMAP long-lived connection starting...");
  connect();
}

module.exports = startInboundPoller;
