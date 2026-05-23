const cron = require("node-cron");
const mailer = require("./mailer");
const store = require("./services/emailStore");
const tracker = require("./services/emailTracker");
const { buildFollowupSubject } = require("./services/emailSubject");
const { getViewerScore } = require("./services/sheetServices");
const { renderFollowupEmail } = require("./templates/emailLayout");

const BASE_URL = process.env.BASE_URL || "http://localhost:4000";

let reminderStarted = false;

function getViewerLevel(score) {
  const value = Number(score || 0);

  if (value >= 77) return "HOT";
  if (value >= 34) return "WARM";
  if (value >= 1) return "COLD";

  return "NO_ACTIVITY";
}

function getTrackedCourse(user, status) {
  if (status?.courseName) return status.courseName;
  if (user?.courseExplicit && user?.course) return user.course;
  return null;
}

function startReminder() {
  if (reminderStarted) return;
  reminderStarted = true;

  cron.schedule("* * * * *", async () => {
    const users = store.getStore();
    const now = Date.now();

    for (const key in users) {
      const user = users[key];
      const session = Number(user.session);

      if (![1, 2, 3].includes(session)) {
        store.deleteUser(key);
        continue;
      }

      if (user.optOut) continue;

      const email = user.email;
      const status = tracker.getStatus(key) || {};
      const opened = status.opened || false;
      const question = status.lastQuestion || null;
      const course = getTrackedCourse(user, status) || "our business programs";
      const name = user.name || "there";
      const lastTime = user.lastInteraction || user.lastSent || 0;
      const diff = now - lastTime;
      const waitTime = opened ? 60 * 1000 : 3 * 60 * 1000;

      if (diff < waitTime) continue;

      let viewerScore = 0;
      try {
        viewerScore = await getViewerScore(email);
      } catch (_) {}

      const viewerLevel = getViewerLevel(viewerScore);

      console.log(`\n${email} | viewerScore:${viewerScore} | level:${viewerLevel} | replied:${!!question}`);

      if (session === 1 || session === 2 || session === 3) {
        const subject = buildFollowupSubject({
          session,
          viewerLevel,
          question,
          course
        });

        const html = await renderFollowupEmail(
          name,
          email,
          course,
          BASE_URL,
          viewerLevel,
          session,
          question
        );

        const userData = store.getStore()[key] || {};
        const result = await mailer.sendEmail({
          to: email,
          subject,
          html,
          inReplyTo: userData.messageId || undefined,
          references: userData.messageId || undefined
        });

        if (result.ok) {
          await tracker.completeSession(key);

          if (session >= 3) {
            store.deleteUser(key);
            console.log(`Final session sent -> ${email} | level:${viewerLevel}`);
          } else {
            store.updateUser(key, {
              session: session + 1,
              lastSent: now
            });

            console.log(`Session ${session + 1} sent -> ${email} | level:${viewerLevel}`);
          }
        }
      } else {
        await tracker.completeSession(key);
        store.deleteUser(key);
        console.log(`All sessions complete -> ${email}`);
      }
    }
  });

  console.log("Email reminder scheduler started");
}

module.exports = startReminder;
