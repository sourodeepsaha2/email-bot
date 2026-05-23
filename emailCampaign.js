require("dotenv").config();

const mailer       = require("./mailer");
const store        = require("./services/emailStore");
const { getNewEmailLeads, markEmailSent, getViewerScore } = require("./services/sheetServices");
const { buildIntroSubject } = require("./services/emailSubject");
const { renderIntroEmail } = require("./templates/emailLayout");

const BASE_URL = process.env.BASE_URL || "http://localhost:4000";

/* ─────────────────────────────────────────
   DELAY — random gap between emails
   Mimics human sending behaviour
   Spam filters flag perfectly timed bulk sends
───────────────────────────────────────── */

function delay() {
  // Random between 15s and 45s — looks human, avoids rate limiting
  return Math.floor(Math.random() * 30000) + 15000;
}

// Extra long pause after every 10 emails — cooling period
function shouldPause(count) {
  return count > 0 && count % 10 === 0;
}

function longPause() {
  // 3-5 minute break after every 10 emails
  return Math.floor(Math.random() * 120000) + 180000;
}

function normalizeEmail(email) {
  return String(email || "").toLowerCase().trim();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function toEmailKey(email) {
  return normalizeEmail(email).replace(/[@.]/g, "_");
}

function getViewerLevel(score) {
  const s = Number(score || 0);
  if (s >= 77) return "HOT";
  if (s >= 34) return "WARM";
  if (s >= 1)  return "COLD";
  return "NO_ACTIVITY";
}

async function sendBulk() {
  const leads = await getNewEmailLeads();

  if (!leads.length) { console.log("No new email leads found"); return; }
  console.log(`📬 Sending to ${leads.length} email leads`);

  let sentCount = 0;

  for (const lead of leads) {
    const name  = lead.name  || "there";
    const email = normalizeEmail(lead.email);

    if (!email || !isValidEmail(email)) {
      console.log("Skipping invalid email:", lead.email);
      await markEmailSent(lead);
      continue;
    }

    const key = toEmailKey(email);

    // Skip bounced or unsubscribed users
    const existing = store.getStore()[key];
    if (existing?.bounced) {
      console.log(`🚫 Skipping bounced: ${email}`);
      await markEmailSent(lead);
      continue;
    }
    if (existing?.unsubscribed || existing?.optOut) {
      console.log(`🚫 Skipping unsubscribed: ${email}`);
      await markEmailSent(lead);
      continue;
    }

    try {
      let viewerScore = 0;
      try { viewerScore = await getViewerScore(email); } catch (_) {}
      const viewerLevel = getViewerLevel(viewerScore);
      console.log(`viewerScore for ${email}: ${viewerScore} → ${viewerLevel}`);

      const html = await renderIntroEmail(name, email, BASE_URL, viewerLevel);

      // Subject passed as undefined — mailer rotates subjects automatically
      const subject = buildIntroSubject({ viewerLevel, name });
      const result = await mailer.sendEmail({
        to  : email,
        subject,
        html
      });

      if (result.ok) {
        store.setUser(key, {
          email,
          name,
          course   : null,
          courseId : null,
          courseExplicit: false,
          session  : 1,
          lastSent : Date.now(),
          optOut   : false,
          messageId: result.messageId
        });

        await markEmailSent(lead);
        sentCount++;
        console.log(`✅ Sent to: ${name} ${email} | level: ${viewerLevel} | count: ${sentCount}`);
      } else {
        console.log("Failed:", email, result.error);
      }

      // Long pause every 10 emails
      if (shouldPause(sentCount)) {
        const pause = longPause();
        console.log(`⏸ Cooling period after ${sentCount} emails — waiting ${Math.round(pause/1000)}s`);
        await new Promise(r => setTimeout(r, pause));
      } else {
        // Normal random delay between sends
        const d = delay();
        console.log(`⏳ Next send in ${Math.round(d/1000)}s`);
        await new Promise(r => setTimeout(r, d));
      }

    } catch (err) {
      console.log("Send error:", email, err.message);
    }
  }

  console.log(`📊 Campaign done — sent: ${sentCount}/${leads.length}`);
}

module.exports = { sendBulk };
