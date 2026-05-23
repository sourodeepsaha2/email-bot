const BASE_URL = process.env.BASE_URL || "http://localhost:4000";
const SOCIAL_LINKS = [
  {
    label: "LinkedIn",
    icon: "https://cdn-icons-png.flaticon.com/24/733/733561.png",
    href: ""
  },
  {
    label: "Instagram",
    icon: "https://cdn-icons-png.flaticon.com/24/733/733558.png",
    href: ""
  },
  {
    label: "YouTube",
    icon: "https://cdn-icons-png.flaticon.com/24/733/733646.png",
    href: ""
  }
].filter(link => link.icon && link.label);

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function para(text) {
  return `<p style="margin:0 0 14px;font-size:15px;color:#333;line-height:1.6;">${text}</p>`;
}

function formatRichText(text) {
  const parts = String(text || "").split(/(\*\*[^*]+\*\*)/g).filter(Boolean);

  return parts.map(part => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return `<strong>${esc(part.slice(2, -2))}</strong>`;
    }

    return esc(part);
  }).join("");
}

function richPara(text) {
  return para(formatRichText(text));
}

function heading(text) {
  return `<p style="margin:18px 0 8px;font-size:15px;font-weight:bold;color:#202124;">${esc(text)}</p>`;
}

function list(items) {
  const rows = (items || [])
    .filter(Boolean)
    .map(item => `<li style="margin-bottom:8px;line-height:1.6;color:#333;">${formatRichText(item)}</li>`)
    .join("");

  return rows ? `<ul style="margin:8px 0 16px;padding-left:20px;">${rows}</ul>` : "";
}

function statsLine(stats) {
  if (!stats?.length) return "";

  const cells = stats
    .filter(stat => stat?.label && stat?.value)
    .map(stat => `<td style="padding:12px 15px;background:#f8f9fa;border-radius:6px;text-align:center;border:1px solid #eaeaea;width:25%;">
      <p style="margin:0 0 4px;font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.5px;font-weight:bold;">${esc(stat.label)}</p>
      <p style="margin:0;font-size:14px;color:#8B0000;font-weight:bold;">${esc(stat.value)}</p>
    </td>`)
    .join('<td width="5"></td>');

  return cells ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 22px;"><tr>${cells}</tr></table>` : "";
}

function programLine(program) {
  if (!program) return "";

  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 20px;background:#ffffff;border:1px solid #eaeaea;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
  <tr>
    <td width="30%" style="background:#f0f0f0;">
      <img src="https://images.unsplash.com/photo-1523050854058-8df90110c9f1?q=80&w=400&h=300&fit=crop" width="100%" style="display:block;height:auto;" alt="Program focus image">
    </td>
    <td width="70%" style="padding:16px 20px;">
      <h3 style="margin:0 0 8px;font-size:16px;color:#202124;">${esc(program.name)}</h3>
      <p style="margin:0 0 6px;font-size:13px;color:#555;"><strong>⏳ Duration:</strong> ${esc(program.duration)} <br/> <strong>👥 Format:</strong> ${esc(program.format)}</p>
      <p style="margin:0;font-size:13px;color:#8B0000;background:#fff5f5;display:inline-block;padding:3px 8px;border-radius:4px;">💳 EMI From ${esc(program.emi)}</p>
    </td>
  </tr>
  </table>`;
}

function cta(key, baseUrl) {
  const url = baseUrl || BASE_URL;

  return `<div style="margin:24px 0 8px;padding:16px;background:#f8f9fa;border-left:3px solid #8B0000;">
<p style="margin:0 0 8px;font-size:14px;color:#333;">
To explore our programs or begin your application:
</p>
<p style="margin:0;font-size:14px;">
<a href="${url}/w/${key}" style="color:#8B0000;text-decoration:none;font-weight:bold;">
View Programs & Apply ->
</a>
</p>
</div>`;
}

function signature() {
  return `<p style="margin:24px 0 2px;font-size:14px;color:#333;">Regards,</p>
<p style="margin:0 0 2px;font-size:14px;font-weight:bold;color:#333;">Priya Sharma</p>
<p style="margin:0 0 2px;font-size:13px;color:#555;">Admissions Counselor - Charters Union of Business</p>
<p style="margin:0;font-size:13px;color:#8B0000;">+91XXXXXXXXXX &nbsp;|&nbsp; admissions@chartersunion.com</p>`;
}

function footerSocial() {
  if (!SOCIAL_LINKS.length) return "";

  const links = SOCIAL_LINKS.map(link => `
${link.href
      ? `<a href="${esc(link.href)}" style="display:inline-block;margin:0 6px;text-decoration:none;" target="_blank" rel="noopener noreferrer" aria-label="${esc(link.label)}">
<img src="${esc(link.icon)}" alt="${esc(link.label)}" width="20" height="20" style="display:block;width:20px;height:20px;opacity:0.9;">
</a>`
      : `<span style="display:inline-block;margin:0 6px;" aria-label="${esc(link.label)}">
<img src="${esc(link.icon)}" alt="${esc(link.label)}" width="20" height="20" style="display:block;width:20px;height:20px;opacity:0.9;">
</span>`}`).join("");

  return `<div style="margin:0 0 12px;text-align:center;">
<p style="margin:0 0 8px;font-size:12px;color:#888;">Connect with Charters Union of Business</p>
${links}
</div>`;
}

function pixel(key, baseUrl) {
  return `<img src="${(baseUrl || BASE_URL)}/img/${key}" width="1" height="1" style="display:none;" alt=""/>`;
}

function emailLayout(title, bodyHtml, key = "", showBanner = true) {
  const unsubLink = `${BASE_URL}/unsubscribe/${key || ""}`;
  const bannerHtml = showBanner ? `
<tr>
<td style="padding:0;text-align:center;">
<img src="https://i.postimg.cc/vTdwtJW0/banner.png"
alt="Charters Union of Business"
style="display:block;width:100%;max-width:600px;height:auto;border-radius:8px 8px 0 0;">
</td>
</tr>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:20px 0;">
<tr>
<td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
${bannerHtml}
<tr>
<td style="padding:28px 32px;color:#333333;font-size:15px;line-height:1.7;">
${bodyHtml}
</td>
</tr>
<tr>
<td style="padding:0 32px;">
<hr style="border:none;border-top:1px solid #eeeeee;margin:0;">
</td>
</tr>
<tr>
<td style="padding:20px 32px;text-align:center;background:#f8f9fa;">
${footerSocial()}
<p style="margin:0 0 6px;font-size:12px;color:#888;">Charters Union of Business | Admissions Team</p>
<p style="margin:0 0 10px;font-size:12px;color:#888;">India | USA | Canada | Dubai | Saudi Arabia | Qatar | Singapore</p>
<p style="margin:0;font-size:11px;color:#aaa;">
You received this email because you enquired about our programs.<br/>
<a href="${unsubLink}" style="color:#aaa;text-decoration:underline;">Unsubscribe</a> | <a href="https://example.com/privacy-policy" style="color:#aaa;text-decoration:underline;">Privacy Policy</a>
</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
}

function buildBody(content, name, key, url) {
  let body = para(`Dear ${esc(name)},`) + richPara(content.intro);

  body += programLine(content.program);
  body += statsLine(content.stats);

  if (content.bullets?.length) {
    body += heading("Key Highlights");
    body += list(content.bullets);
  }

  if (content.programs?.length) {
    body += heading("Programs");
    body += list(
      content.programs.map(program =>
        `**${program.name}** - ${program.duration} | EMI from ${program.emi} | Placement ${program.placement}`
      )
    );
  }

  body += cta(key, url) + signature() + pixel(key, url);
  return body;
}

async function renderIntroEmail(name, email, baseUrl, viewerLevel) {
  const { getIntroContent } = require("../services/contentAgent");

  const key = String(email || "").replace(/[@.]/g, "_");
  const url = baseUrl || BASE_URL;
  const content = await getIntroContent(name, viewerLevel, email);
  const body = buildBody(content, name, key, url);

  return emailLayout(content.heading || "Program Information", body, key, true);
}

async function renderFollowupEmail(name, email, course, baseUrl, viewerLevel, session, question = null) {
  const { getFollowupContent } = require("../services/contentAgent");

  const key = String(email || "").replace(/[@.]/g, "_");
  const url = baseUrl || BASE_URL;
  const content = await getFollowupContent(name, course, viewerLevel, session, question, email);
  const body = buildBody(content, name, key, url);

  return emailLayout(content.heading || "Program Follow-up", body, key, true);
}

async function renderReplyEmail(userMessage, userKey, intent, baseUrl, options = {}) {
  const { getReplyContent } = require("../services/contentAgent");

  const key = String(userKey || "").replace(/[@.]/g, "_");
  const url = baseUrl || BASE_URL;
  const content = await getReplyContent(userMessage, intent, {
    ...options,
    userKey
  });
  const body = buildBody(content, options.name || "Applicant", key, url);

  return emailLayout(content.heading || "Program Details", body, key, false);
}

module.exports = {
  emailLayout,
  renderIntroEmail,
  renderFollowupEmail,
  renderReplyEmail
};
