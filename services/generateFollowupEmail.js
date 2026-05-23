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

/* ─── BUILD PROGRAM DATA ─── */
function buildFacts(course) {
  const program = (programs?.programs || []).find(p =>
    String(course || "").toLowerCase().includes((p.id || "").toLowerCase()) ||
    String(course || "").toLowerCase().includes((p.name || "").toLowerCase().split(" ")[0])
  );

  let facts = `
Average CTC (overall): ${safeText(home?.placement_highlights?.average_ctc)}
Highest CTC (overall): ${safeText(home?.placement_highlights?.highest_ctc)}
Recruiters: ${safeText(home?.placement_highlights?.recruiters)}
Faculty from: ${safeJoin(faculty?.top_institutions?.slice(0, 3))}
  `.trim();

  if (program) {
    const p = program.placement || program.career_growth;
    facts += `\nProgram: ${program.name}`;
    facts += `\nDuration: ${program.duration} | Format: ${program.format}`;
    facts += `\nStarts: ${program.start_date}`;
    facts += `\nEligibility: ${program.eligibility}`;
    facts += `\nEMI from: ${program.fees?.emi_start} | Scholarship: ${program.fees?.scholarship}`;
    if (p) {
      facts += `\nPlacement rate: ${p.placement_rate || p.promotion_rate}`;
      facts += `\nAverage CTC: ${p.average_ctc} | Range: ${p.salary_range}`;
    }
  }

  return facts;
}

/* ─── TONE ─── */
function getToneGuide(viewerLevel, session) {
  if (session >= 2) {
    return "This is the final follow-up. Be professional but clear — the batch is filling up and seats are limited. One direct, respectful ask to apply or reply within the next few days.";
  }
  switch (viewerLevel) {
    case "HOT":  return "Confident and direct. They have shown strong interest. Reference the upcoming batch and limited seats. Ask them to take the next step.";
    case "WARM": return "Professional and encouraging. Share one specific outcome — placement stat or faculty detail. Ask one follow-up question.";
    case "COLD": return "Friendly and low-pressure. Short and light. A gentle check-in. Just remind them you are available to answer questions.";
    default:     return "Professional and brief. One key point. Soft invitation to reply.";
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
    </p>`;
}

/* ─── CTA ─── */
function ctaLine(key, baseUrl) {
  return `
    <p style="margin:24px 0 0;padding:16px;background:#fafafa;border-left:3px solid #8B0000;font-size:14px;color:#333333;">
      To view program details or begin your application:<br/>
      <a href="${baseUrl}/w/${key}" style="color:#8B0000;font-weight:bold;text-decoration:none;">View Programs &amp; Apply &rarr;</a>
    </p>`;
}

/* ─── GENERATE FOLLOWUP ─── */
async function generateFollowupEmail(context, course, email, baseUrl = BASE_URL, viewerLevel = "NO_ACTIVITY", name = "there", session = 1) {
  const key       = String(email || "").replace(/[@.]/g, "_");
  const firstName = String(name || "there").split(" ")[0].trim() || "there";
  const toneGuide = getToneGuide(viewerLevel, session);
  const facts     = buildFacts(course);

  const prompt = `
You are Priya Sharma, an admissions counselor at Charters Union of Business.
Write a short formal follow-up email to ${firstName}.

Context about this person: ${context}
Program of interest: ${course || "our programs"}
Tone: ${toneGuide}
This is follow-up number: ${session}

Use ONLY these facts — do not invent anything:
${facts}

Strict rules:
- Start with exactly: <p>Dear ${firstName},</p>
- Write 2 short paragraphs only
- Paragraph 1: Brief reference to your earlier email, acknowledge where they are in their decision
- Paragraph 2: One specific fact relevant to their context, end with one clear question or ask
- Do NOT use: emojis, exclamation marks, "I hope this email finds you", "world-class", "as per our records", "kindly revert", "please find"
- Do NOT include bullet points, headers, links, buttons, or signature
- Do NOT include <html>, <head>, <body> tags
- Return ONLY plain HTML paragraphs using <p> tags
`;

  try {
    const aiContent = await askAI(prompt);
    if (aiContent && typeof aiContent === "string" && aiContent.trim().length > 50) {
      // Safety — strip any rogue links AI might inject
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
      `;
      return emailLayout(`Follow-up — ${course || "Charters Union of Business"}`, body, key);
    }
  } catch (err) {
    console.log("Followup AI error:", err.message, "— using fallback");
  }

  // ── FALLBACK ──
  const avgCtc    = safeText(home?.placement_highlights?.average_ctc);
  const recruiters = safeText(home?.placement_highlights?.recruiters);
  const isSession2 = session >= 2;

  const body = `
    <p>Dear ${firstName},</p>

    <p style="margin:16px 0 0;">
      ${isSession2
        ? `I wanted to follow up once more regarding the ${course || "programs"} at Charters Union of Business. We have very limited seats remaining in the upcoming batch.`
        : `I am following up on my earlier email regarding our ${course || "programs"} at Charters Union of Business.`
      }
    </p>

    <p style="margin:16px 0 0;">
      ${isSession2
        ? `If you have any outstanding questions, I would be happy to address them directly. The batch starts soon and I would not want you to miss the opportunity.`
        : `Our recent batch achieved an average placement of ${avgCtc}, with ${recruiters} companies recruiting. I would be glad to answer any questions you may have about the program or the admission process.`
      }
    </p>

    ${ctaLine(key, baseUrl)}
    ${signature()}
    <img src="${baseUrl}/img/${key}" width="1" height="1" style="display:none;" alt=""/>
  `;

  return emailLayout(`Follow-up — ${course || "Charters Union of Business"}`, body, key);
}

module.exports = generateFollowupEmail;