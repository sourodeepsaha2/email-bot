const { renderReplyEmail } = require("./templates/emailLayout");
const store = require("./services/emailStore");
const tracker = require("./services/emailTracker");

const BASE_URL = process.env.BASE_URL || "http://localhost:4000";

function getViewerLevelFromStatus(status) {
  const score = Number(status?.finalScore || 0);

  if (score >= 8) return "HOT";
  if (score >= 5) return "WARM";
  if (score >= 1) return "COLD";
  return "NO_ACTIVITY";
}

function getTrackedCourse(user, status) {
  if (status?.courseName) return status.courseName;
  if (user?.courseExplicit && user?.course) return user.course;
  return "";
}

async function emailReplyEngine(msg, userKey, intent = "OTHER", leadName = "") {
  const user = store.getStore()[userKey] || {};
  const status = tracker.getStatus(userKey) || {};

  return renderReplyEmail(msg.body || "", userKey, intent, BASE_URL, {
    name: leadName || user.name || "Applicant",
    email: user.email || "",
    course: getTrackedCourse(user, status),
    session: user.session || status.session || 1,
    viewerLevel: getViewerLevelFromStatus(status)
  });
}

module.exports = emailReplyEngine;
