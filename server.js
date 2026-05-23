require("dotenv").config();

const express       = require("express");
const app           = express();
const tracker       = require("./services/emailTracker");
const { sendBulk }  = require("./emailCampaign");
const startReminder = require("./emailScheduler");
const startInboundPoller = require("./services/inboundPoller");
const {
  verifyConnection, closeTransporter,
  getDailyCount, isDailyLimitReached, getEffectiveLimit
} = require("./mailer");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
/* ─── RATE LIMITER — in-memory, no extra package ─── */
const rateLimitMap = new Map();

function getRequestMeta(req, source = "pixel") {
  return {
    ip: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown",
    userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
    source
  };
}

function rateLimit(maxPerMin) {
  return (req, res, next) => {
    const ip  = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    const key = `${req.path}:${ip}`;
    const now = Date.now();
    const win = rateLimitMap.get(key) || { count: 0, start: now };

    if (now - win.start > 60000) {
      win.count = 0;
      win.start = now;
    }

    win.count++;
    rateLimitMap.set(key, win);

    if (rateLimitMap.size > 500) {
      for (const [k, v] of rateLimitMap) {
        if (now - v.start > 60000) rateLimitMap.delete(k);
      }
    }

    if (win.count > maxPerMin) {
      return res.status(429).json({ error: "Too many requests" });
    }
    next();
  };
}
/* ─── SECURITY HEADERS ─── */
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

let runtimeStarted = false;

/* ─── TRACKING PIXEL ─── */
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

app.get("/img/:key", rateLimit(10), (req, res) => {
  const key = sanitizeParam(req.params.key);
  if (!key) return res.status(400).end();
  tracker.trackOpen(key, getRequestMeta(req, "pixel"));
  console.log("👀 Email opened:", key);
  res.writeHead(200, {
    "Content-Type"  : "image/gif",
    "Content-Length": PIXEL.length,
    "Cache-Control" : "no-store, no-cache, must-revalidate",
    "Pragma"        : "no-cache",
    "Expires"       : "0",
    "X-Robots-Tag"  : "noindex, nofollow, noimageindex"
  });
  res.end(PIXEL);
});

/* ─── CLICK TRACKERS ─── */
app.get("/w/:key", rateLimit(10), (req, res) => {
  const key = sanitizeParam(req.params.key);
  if (!key) return res.redirect("https://charter-temp.vercel.app");
  tracker.trackOpen(key, getRequestMeta(req, "cta"));
  tracker.trackClick(key);
  console.log("🌐 Clicked (programs):", key);
  res.redirect("https://charter-temp.vercel.app");
});

app.get("/a/:key", rateLimit(10), (req, res) => {
  const key = sanitizeParam(req.params.key);
  if (!key) return res.redirect("https://charter-temp.vercel.app/apply");
  tracker.trackOpen(key, getRequestMeta(req, "apply"));
  tracker.trackClick(key);
  console.log("🌐 Clicked (apply):", key);
  res.redirect("https://charter-temp.vercel.app/apply");
});

/* ─── STATUS ─── */
app.get("/status", (req, res) => {
  const token= req.query.token || req.headers["x-status-token"]
  if (token !== (process.env.STATUS_TOKEN)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  res.json({
    status       : "running",
    dailyCount   : getDailyCount(),
    dailyLimit   : getEffectiveLimit(),
    limitReached : isDailyLimitReached(),
    uptime       : process.uptime(),
    memoryMB     : Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
  });
});

/* ─── UNSUBSCRIBE ─── */
app.get("/unsubscribe/:key", (req, res) => {
  const key   = sanitizeParam(req.params.key);
  const store = require("./services/emailStore");
  const users = store.getStore();

  if (key && users[key]) {
    store.updateUser(key, {
      optOut      : true,
      unsubscribed: true,
      unsubAt     : Date.now()
    });
    console.log(`🚫 Unsubscribed via link: ${users[key]?.email}`);
  }

  res.send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><title>Unsubscribed</title></head>
<body style="font-family:Arial,sans-serif;text-align:center;padding:60px;background:#f4f4f4;">
  <div style="background:#fff;border-radius:8px;padding:40px;max-width:400px;margin:0 auto;">
    <h2 style="color:#8B0000;">You've been unsubscribed</h2>
    <p style="color:#666;">You will no longer receive emails from Charters Union.</p>
    <p style="color:#aaa;font-size:12px;">If this was a mistake, reply to any of our emails to re-subscribe.</p>
  </div>
</body>
</html>`);
});

/* ─── ROOT ─── */
app.get("/", (req, res) => res.send("Email Bot running"));

/* ─── SANITIZE ROUTE PARAMS ─── */
function sanitizeParam(val) {
  if (!val) return "";
  return String(val).replace(/[^a-zA-Z0-9_\-]/g, "").slice(0, 200);
}

/* ─── START ─── */
async function startServer() {
  if (runtimeStarted) return;
  runtimeStarted = true;

  const smtpOk = await verifyConnection();
  if (!smtpOk) {
    console.error("❌ SMTP connection failed — check .env credentials");
    process.exit(1);
  }

  console.log(`📊 Daily emails today: ${getDailyCount()}/${getEffectiveLimit()}`);

  startInboundPoller();
  startReminder();

  console.log("Starting email campaign...");
  await sendBulk();

  setInterval(async () => {
    console.log("Checking new email leads...");
    await sendBulk();
  }, 180000);
}

/* ─── GRACEFUL SHUTDOWN ─── */
process.on("SIGTERM", () => { closeTransporter(); process.exit(0); });
process.on("SIGINT",  () => { closeTransporter(); process.exit(0); });

/* ─── ERROR HANDLING ─── */
process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Rejection:", err?.message || err);
});
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err?.message || err);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ Email Bot running on port ${PORT}`);
  startServer();
});
