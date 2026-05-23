require("dotenv").config();
const axios = require("axios");

const GROQ_KEY = process.env.GROQ_API_KEY;

/* ─────────────────────────────────────────
   GROQ RATE LIMIT GUARD
   Free tier: 30 req/min, 14400 req/day
   Counter resets every minute
───────────────────────────────────────── */
let reqCount   = 0;
let windowStart = Date.now();
const MAX_REQ_PER_MIN = 25; // stay under 30 limit

function isRateLimited() {
  const now = Date.now();
  if (now - windowStart > 60000) {
    // New minute window — reset
    reqCount    = 0;
    windowStart = now;
  }
  if (reqCount >= MAX_REQ_PER_MIN) {
    console.warn(`⚠️  Groq rate limit guard: ${reqCount} req this minute — skipping AI call`);
    return true;
  }
  reqCount++;
  return false;
}

async function askAI(prompt, maxTokens = 500) {
  if (!GROQ_KEY) return null;

  // Rate limit guard — return null so fallback static content is used
  if (isRateLimited()) return null;

  try {
    const res = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model      : "llama-3.1-8b-instant",
        messages   : [{ role: "user", content: prompt }],
        max_tokens : maxTokens,
        temperature: 0.7
      },
      {
        headers : {
          Authorization : `Bearer ${GROQ_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 10000  // 10s timeout — don't hang
      }
    );
    return res.data.choices[0].message.content.trim();
  } catch (err) {
    // 429 = rate limited by Groq
    if (err.response?.status === 429) {
      console.warn("⚠️  Groq 429 rate limit — using fallback");
    }
    return null;
  }
}

module.exports = askAI;