const fs = require("fs");
const FILE = "./emailEngagement.json";
const { updateEmailScore } = require("./sheetServices");

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 2000;
const OPEN_DEBOUNCE_MS = 5 * 60 * 1000;

function load() {
  const now = Date.now();
  if (cache && (now - cacheTime) < CACHE_TTL) return cache;

  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, "{}");
    cache = {};
    cacheTime = now;
    return cache;
  }

  try {
    cache = JSON.parse(fs.readFileSync(FILE));
    cacheTime = now;
    return cache;
  } catch (_) {
    return cache || {};
  }
}

function save(data) {
  const tmp = `${FILE}.tmp`;

  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, FILE);
    cache = data;
    cacheTime = Date.now();
  } catch (err) {
    console.error("emailTracker save error:", err.message);
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

function init(key) {
  const data = load();

  if (!data[key]) {
    data[key] = {
      session: 1,
      opened: false,
      replied: false,
      clicked: false,
      score: 0,
      finalScore: 0,
      level: "COLD",
      openCount: 0,
      clickCount: 0
    };
    save(data);
  }

  return { data, key };
}

function trackOpen(key, meta = {}) {
  const { data } = init(key);
  const now = Date.now();
  const shouldCount = !data[key].lastOpenAt || (now - data[key].lastOpenAt) > OPEN_DEBOUNCE_MS;

  if (shouldCount) {
    data[key].openCount = (data[key].openCount || 0) + 1;
  }

  data[key].opened = true;
  data[key].firstOpenAt = data[key].firstOpenAt || now;
  data[key].lastOpenAt = now;
  data[key].lastOpenIp = meta.ip || data[key].lastOpenIp || null;
  data[key].lastOpenUserAgent = meta.userAgent || data[key].lastOpenUserAgent || null;
  data[key].lastOpenSource = meta.source || data[key].lastOpenSource || "pixel";
  save(data);

  console.log(`EMAIL OPEN: ${key} (total opens: ${data[key].openCount || 0})`);
}

function trackReply(key) {
  const { data } = init(key);

  if (!data[key].replied) {
    data[key].replied = true;
    data[key].repliedAt = Date.now();
    save(data);
    console.log("EMAIL REPLY:", key);
  }
}

function trackClick(key) {
  const { data } = init(key);
  data[key].clickCount = (data[key].clickCount || 0) + 1;
  data[key].clicked = true;
  data[key].lastClickAt = Date.now();
  save(data);
  console.log(`EMAIL CLICK: ${key} (total clicks: ${data[key].clickCount})`);
}

function trackCourseView(key, course) {
  const { data } = init(key);
  data[key].courseViewed = true;
  data[key].courseName = course;
  save(data);
}

function saveLastQuestion(key, text) {
  const { data } = init(key);
  data[key].lastQuestion = text;
  data[key].lastQuestionAt = Date.now();
  save(data);
}

async function completeSession(key) {
  const data = load();
  const user = data[key];
  if (!user) return;

  let sessionScore = 0;
  if (user.opened) sessionScore += 11;
  if (user.replied) sessionScore += 11;
  if (user.clicked) sessionScore += 11;

  user.score += sessionScore;
  user.finalScore = Math.round(user.score / 10);
  user.level = user.finalScore >= 8 ? "HOT" : user.finalScore >= 5 ? "WARM" : "COLD";
  user.completedAt = Date.now();

  if (sessionScore > 0) {
    try {
      await updateEmailScore(key, user.finalScore, user.level);
    } catch (err) {
      console.log("Sheet score update failed:", err.message);
    }
  }

  console.log(`
EMAIL ENGAGEMENT
Key        : ${key}
Session    : ${user.session}
Opened     : ${user.opened} (${user.openCount || 0}x)
Replied    : ${user.replied}
Clicked    : ${user.clicked} (${user.clickCount || 0}x)
SessionPts : ${sessionScore}
TotalScore : ${user.score}
FinalScore : ${user.finalScore}/10
Level      : ${user.level}
------------------------`);

  user.opened = false;
  user.replied = false;
  user.clicked = false;
  user.lastQuestion = null;
  if (user.session < 3) user.session += 1;

  save(data);
}

function scoreOutOf10(key) {
  return load()[key]?.finalScore || 0;
}

function getStatus(key) {
  return load()[key] || null;
}

module.exports = {
  trackOpen,
  trackReply,
  trackClick,
  trackCourseView,
  saveLastQuestion,
  completeSession,
  getStatus,
  scoreOutOf10
};
