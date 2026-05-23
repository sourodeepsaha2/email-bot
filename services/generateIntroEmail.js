require("dotenv").config();
const { emailLayout } = require("../templates/emailLayout");
const askAI = require("./aiReply");

const programs  = require("../data/programs.json");
const faculty   = require("../data/faculty.json");
const institute = require("../data/institute.json");
const home      = require("../data/home.json");

function safeJoin(v) { return Array.isArray(v) ? v.join(", ") : String(v || ""); }
function safeText(v) { return v ? (typeof v === "string" ? v : JSON.stringify(v)) : ""; }

const BASE_URL = process.env.BASE_URL || "http://localhost:4000";

/* ─── TONE PER VIEWER LEVEL ─── */
function getToneGuide(viewerLevel) {
  switch (viewerLevel) {
    case "HOT":  return "Direct and confident. They are clearly interested. Mention limited seats and upcoming batch. One clear ask — reply or apply now.";
    case "WARM": return "Warm and benefit-focused. Reference one placement outcome and one global exposure point. Invite a reply.";
    case "COLD": return "Friendly and light. Brief introduction. No pressure. Just open a conversation with a soft question.";
    default:     return "Professional and warm. Brief overview. Soft invitation to reply or ask a question.";
  }
}

/* ─── SIGNATURE ─── */
function signature() {
  return `
    <p style="margin:32px 0 0;font-size:14px;color:#333333;line-height:1.6;">
      Regards,<br/>
      <strong>Priya Sharma</strong><br/>
      <span style="color:#666666;">Admissions Counselor</span><br/>
      <span style="color:#666666;">Charters Union of Business</span><br/>
      <span style="color:#8B0000;font-size:13px;">+91XXXXXXXXXX &nbsp;|&nbsp; admissions@chartersunion.com</span>
    </p>
    <p style="margin:12px 0 0;font-size:12px;color:#999999;font-style:italic;">
      This is a personal outreach from our admissions team. Please reply directly to this email with any questions.
    </p>`;
}

/* ─── SINGLE CTA LINK ─── */
function ctaLine(key, baseUrl) {
  return `
    <p style="margin:24px 0 0;padding:16px;background:#fafafa;border-left:3px solid #8B0000;font-size:14px;color:#333333;">
      To explore our programs or begin your application:<br/>
      <a href="${baseUrl}/w/${key}" style="color:#8B0000;font-weight:bold;text-decoration:none;">View Programs &amp; Apply &rarr;</a>
    </p>`;
}

/* ─── GENERATE INTRO EMAIL ─── */
async function generateIntroEmail(name = "there", email, baseUrl = BASE_URL, viewerLevel = "NO_ACTIVITY") {
  const key       = String(email || "").replace(/[@.]/g, "_");
  const firstName = String(name || "there").split(" ")[0].trim() || "there";
  const toneGuide = getToneGuide(viewerLevel);

  const facts = `
Programs: ${safeJoin((programs?.programs || []).map(p => p.name))}
Average CTC: ${safeText(home?.placement_highlights?.average_ctc)}
Highest CTC: ${safeText(home?.placement_highlights?.highest_ctc)}
Recruiters: ${safeText(home?.placement_highlights?.recruiters)}
Faculty from: ${safeJoin(faculty?.top_institutions?.slice(0, 3))}
Global presence: ${safeJoin(institute?.global_presence?.slice(0, 4))}
  `.trim();

  const prompt = `
You are Priya Sharma, an admissions counselor at Charters Union of Business.
Write a short, formal introductory email to ${firstName}.

Tone: ${toneGuide}

Use ONLY these facts — do not invent anything:
${facts}

Strict rules:
- Start with exactly: <p>Dear ${firstName},</p>
- Write 2 short paragraphs only
- Paragraph 1: Brief personal introduction — who you are, why you are reaching out, mention 1-2 program names naturally
- Paragraph 2: One specific fact (placement stat or faculty), end with one soft question like "Would you like me to share more details about a specific program?"
- Do NOT use: emojis, exclamation marks, "I hope this email finds you", "world-class", "state-of-the-art", "I am excited", "we look forward", "kindly", "please find attached"
- Do NOT include bullet points, headers, links, buttons, or signature
- Do NOT include <html>, <head>, <body> tags
- Return ONLY plain HTML paragraphs using <p> tags
`;

  try {
    const aiContent = await askAI(prompt);
    if (aiContent && typeof aiContent === "string" && aiContent.trim().length > 50) {
      // Safety check — remove any rogue links or buttons AI might inject
      const safeContent = aiContent
        .replace(/<a\s[^>]*>.*?<\/a>/gi, "")
        .replace(/<button[^>]*>.*?<\/button>/gi, "")
        .replace(/href\s*=/gi, "")
        .trim();

      const body = `
        ${safeContent}
        ${ctaLine(key, baseUrl)}
        ${signature()}
        <img src="${baseUrl}/img/${key}" width="1" height="1" style="display:none;" alt=""/>
        <p style="display:none;">DZEEPDDPMRV</p>
      `;
      return emailLayout("Admissions enquiry — Charters Union of Business", body, key);
    }
  } catch (err) {
    console.log("Intro AI error:", err.message, "— using fallback");
  }

  // ── FALLBACK — static formal ──
  const programNames = (programs?.programs || []).map(p => p.name).join(", ");
  const body = `
    <p>Dear ${firstName},</p>

    <p style="margin:16px 0 0;">
      I am reaching out from the Admissions Office at Charters Union of Business. We currently offer
      ${programNames} — programs designed for professionals looking to advance their careers with
      global exposure and industry-led education.
    </p>

    <p style="margin:16px 0 0;">
      Our recent batch achieved an average placement of ${safeText(home?.placement_highlights?.average_ctc)},
      with ${safeText(home?.placement_highlights?.recruiters)} companies actively recruiting,
      including firms from the USA, Dubai, and Singapore.
      Faculty includes professionals from ${safeJoin(faculty?.top_institutions?.slice(0, 3))}.
      Would you like me to send you detailed information about a specific program?
    </p>

    ${ctaLine(key, baseUrl)}
    ${signature()}
    <img src="${baseUrl}/img/${key}" width="1" height="1" style="display:none;" alt=""/>
    <p style="display:none;">DZEEPDDPMRV</p>
  `;

  return emailLayout("Admissions enquiry — Charters Union of Business", body, key);
}

module.exports = generateIntroEmail;