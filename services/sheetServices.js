const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");

/*
   Sheet column mapping:
   Col 0  → mongo_id
   Col 1  → name
   Col 2  → email
   Col 3  → role
   Col 4  → phoneNumber
   Col 5  → lastLogin
   Col 6  → viewerScore
   Col 7  → visitCount
   Col 8  → pagesNavigated
   Col 9  → chatInteractions
   Col 10 → loggedIn
   Col 11 → deviceId
   Col 12 → sessionId
   Col 13 → createdAt
   Col 14 → updatedAt
   Col 15 → sent (WA sent)
   Col 16 → wpscore
   Col 17 → level (WA level)
   Col 18 → sentmail (Email Sent flag)
   Col 19 → emailScore
   Col 20 → emailLevel
*/

function cleanPrivateKey(key) {
  if (!key) return "";
  let cleaned = String(key).trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || 
      (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned.replace(/\\n/g, "\n");
}

const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: cleanPrivateKey(process.env.GOOGLE_PRIVATE_KEY),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const doc = new GoogleSpreadsheet(process.env.SHEET_ID, serviceAccountAuth);

const EMAIL_CACHE_TTL = 5 * 60 * 1000;
const VIEWER_CACHE_TTL = 2 * 60 * 1000;

let emailCache = { at: 0, set: new Set() };
const viewerScoreCache = {};
const VIEWER_CACHE_MAX = 500; // Max entries — prevent unbounded growth

function digitsOnly(v) { return String(v || "").replace(/\D/g, ""); }

async function loadSheet() {
  await doc.loadInfo();
  return doc.sheetsByIndex[0];
}

/* ─── EMAIL SET CACHE ─── */
async function getEmailSet(force = false) {
  const now = Date.now();
  if (!force && now - emailCache.at < EMAIL_CACHE_TTL && emailCache.set.size) {
    return emailCache.set;
  }
  const sheet = await loadSheet();
  const rows = await sheet.getRows();
  const set = new Set();
  for (const row of rows) {
    const email = String(row._rawData[2] || "").toLowerCase().trim();
    if (email) set.add(email);
  }
  emailCache = { at: now, set };
  return set;
}

/* ─── GET NEW EMAIL LEADS ─── */
async function getNewEmailLeads() {
  const sheet = await loadSheet();
  const rows = await sheet.getRows();
  console.log("📋 TOTAL ROWS:", rows.length);
  const leads = rows
    .map(row => ({
      row,
      name: row._rawData[1] || "",
      email: String(row._rawData[2] || "").toLowerCase().trim(),
      emailSent: row._rawData[18] || ""
    }))
    .filter(item =>
      item.email &&
      item.email.includes("@") &&
      String(item.emailSent || "").toLowerCase() !== "yes"
    );
  console.log("📬 NEW EMAIL LEADS:", leads.length);
  return leads;
}

/* ─── MARK EMAIL SENT ─── */
async function markEmailSent(lead) {
  try {
    lead.row._rawData[18] = "yes";
    await lead.row.save();
    console.log("✅ Email marked sent →", lead.email);
  } catch (err) {
    console.log("Sheet markEmailSent error:", err.message);
  }
}

/* ─── ADD NEW EMAIL LEAD ─── */
async function addNewEmailLead(email, name = "") {
  try {
    const target = String(email || "").toLowerCase().trim();
    if (!target) return;
    const emails = await getEmailSet();
    if (emails.has(target)) return;
    const sheet = await loadSheet();
    await sheet.addRow(["", name, "", "", "", target]);
    emails.add(target);
    console.log("📝 New email lead added:", target);
  } catch (err) {
    console.log("addNewEmailLead error:", err.message);
  }
}

/* ─── UPDATE EMAIL SCORE → T col (19), U col (20) ─── */
async function updateEmailScore(key, score, level) {
  try {
    const sheet = await loadSheet();
    const rows = await sheet.getRows();
    for (const row of rows) {
      const rowEmail = String(row._rawData[2] || "").toLowerCase().replace(/[@.]/g, "_");
      if (rowEmail === key) {
        row._rawData[19] = score;
        row._rawData[20] = level;
        await row.save();
        // Invalidate viewer cache for this email
        const emailKey = String(row._rawData[2] || "").toLowerCase().trim();
        if (viewerScoreCache[emailKey]) delete viewerScoreCache[emailKey];
        console.log("📊 Email score updated:", key, score, level);
        return;
      }
    }
    console.log("Score row not found for:", key);
  } catch (err) {
    console.log("updateEmailScore error:", err.message);
  }
}

/* ─── GET VIEWER SCORE → G col (6) ─── */
async function getViewerScore(email) {
  const target = String(email || "").toLowerCase().trim();
  if (!target) return 0;

  const cached = viewerScoreCache[target];
  if (cached && Date.now() - cached.at < VIEWER_CACHE_TTL) {
    return cached.score;
  }

  try {
    const sheet = await loadSheet();
    const rows = await sheet.getRows();
    for (const row of rows) {
      const rowEmail = String(row._rawData[2] || "").toLowerCase().trim();
      if (rowEmail === target) {
        const score = Number(row._rawData[6] || 0);
        // Evict oldest entry if cache is full
        if (Object.keys(viewerScoreCache).length >= VIEWER_CACHE_MAX) {
          const oldest = Object.keys(viewerScoreCache).reduce((a, b) =>
            viewerScoreCache[a].at < viewerScoreCache[b].at ? a : b
          );
          delete viewerScoreCache[oldest];
        }
        viewerScoreCache[target] = { score, at: Date.now() };
        console.log(`👁 viewerScore for ${target}: ${score}`);
        return score;
      }
    }
  } catch (err) {
    console.log("getViewerScore error:", err.message);
  }

  return 0;
}

module.exports = {
  getNewEmailLeads,
  markEmailSent,
  addNewEmailLead,
  updateEmailScore,
  getViewerScore
};