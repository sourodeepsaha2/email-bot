require("dotenv").config();

const askAI = require("./aiReply");
const detectIntent = require("./detectIntent");
const findProgram = require("./findProgram");
const { programs, faculty, institute, home } = require("./dataLoader");

function safeText(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value.trim() : String(value).trim();
}

function safeJoin(value, limit = 0) {
  const items = Array.isArray(value) ? value.filter(Boolean) : [];
  const sliced = limit > 0 ? items.slice(0, limit) : items;
  return sliced.join(", ");
}

function cleanQuestion(text) {
  return safeText(text).replace(/\s+/g, " ").trim();
}

function titleCase(text) {
  return safeText(text).toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
}

function hashSeed(input) {
  const text = safeText(input) || "seed";
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function buildSeed(parts) {
  return hashSeed(parts.filter(Boolean).join("|"));
}

function pickVariant(items, seed, offset = 0) {
  if (!Array.isArray(items) || !items.length) return "";
  return items[(seed + offset) % items.length];
}

function dedupe(items) {
  const seen = new Set();

  return (items || []).filter(item => {
    const value = safeText(item);
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function getPlacement(program) {
  return program?.placement || program?.career_growth || {};
}

function maybeStat(label, value) {
  return safeText(value) ? { label, value: safeText(value) } : null;
}

function compactIntro(text) {
  return safeText(text)
    .replace(/\s+/g, " ")
    .replace(/([.!?])\s+/g, "$1 ")
    .trim();
}

function summarizeProgram(program) {
  if (!program) return null;

  const placement = getPlacement(program);

  return {
    name: program.name,
    duration: program.duration,
    format: program.format,
    emi: program.fees?.emi_start || "",
    placement: placement.placement_rate || placement.promotion_rate || ""
  };
}

function buildProgramList(seed) {
  return (programs?.programs || [])
    .map(program => summarizeProgram(program))
    .filter(program => program?.name)
    .sort((a, b) => hashSeed(`${a.name}|${seed}`) - hashSeed(`${b.name}|${seed}`))
    .slice(0, 3);
}

function getProgramStats(program) {
  const placement = getPlacement(program);

  if (!program) {
    return [
      maybeStat("Highest CTC", home?.placement_highlights?.highest_ctc),
      maybeStat("Average CTC", home?.placement_highlights?.average_ctc),
      maybeStat("Placement Rate", "95%"),
      maybeStat("Recruiters", home?.placement_highlights?.recruiters)
    ].filter(Boolean);
  }

  return [
    maybeStat("Placement Rate", placement.placement_rate || placement.promotion_rate),
    maybeStat("Average CTC", placement.average_ctc),
    maybeStat("Salary Range", placement.salary_range),
    maybeStat("Next Batch", program.start_date)
  ].filter(Boolean);
}

function getViewerProfile(viewerLevel) {
  const profiles = {
    HOT: { tone: "confident and direct" },
    WARM: { tone: "helpful and specific" },
    COLD: { tone: "simple and trust-building" },
    NO_ACTIVITY: { tone: "friendly and informative" }
  };

  return profiles[viewerLevel] || profiles.NO_ACTIVITY;
}

function getQuestionInsight(intent, program, question) {
  const placement = getPlacement(program);
  const isWeekendFriendly = safeText(program?.format).toLowerCase().includes("weekend");

  const map = {
    ASK_DURATION: {
      heading: "Program Duration and Format",
      intro: program
        ? `The **${program.name}** runs for **${program.duration}** in a **${program.format}** format.`
        : `I have shared the key duration and format details below.`,
      bullets: dedupe([
        program?.duration ? `**Duration:** ${program.duration}` : "",
        program?.format ? `**Format:** ${program.format}` : "",
        program?.start_date ? `**Next batch:** ${program.start_date}` : "",
        isWeekendFriendly ? "**Schedule fit:** suitable for working professionals" : ""
      ])
    },
    ASK_FEE: {
      heading: "Fees and Payment Options",
      intro: program
        ? `Here are the main **fee and payment details** for the **${program.name}**.`
        : `Here are the main **fee and payment details** available right now.`,
      bullets: dedupe([
        program?.fees?.emi_start ? `**EMI starts from:** ${program.fees.emi_start}` : "",
        program?.fees?.scholarship ? `**Scholarship support:** ${program.fees.scholarship}` : "",
        program?.fees?.no_cost_emi ? `**Flexible plans:** ${program.fees.no_cost_emi}` : "",
        program?.fees?.seat_booking ? `**Seat booking amount:** ${program.fees.seat_booking}` : ""
      ])
    },
    ASK_PLACEMENT: {
      heading: "Placement Outcomes",
      intro: program
        ? `These are the main **career outcome details** for the **${program.name}**.`
        : `These are the main **career outcome details** we can share right now.`,
      bullets: dedupe([
        placement.placement_rate ? `**Placement rate:** ${placement.placement_rate}` : "",
        placement.promotion_rate ? `**Promotion rate:** ${placement.promotion_rate}` : "",
        placement.average_ctc ? `**Average CTC:** ${placement.average_ctc}` : "",
        placement.salary_range ? `**Salary range:** ${placement.salary_range}` : ""
      ])
    },
    ASK_PROGRAM: {
      heading: "Program Overview",
      intro: program
        ? `Here is a quick **program snapshot** for the **${program.name}**.`
        : `Here is a quick **program snapshot** to help you compare options.`,
      bullets: dedupe([
        program?.duration ? `**Duration:** ${program.duration}` : "",
        program?.format ? `**Format:** ${program.format}` : "",
        program?.eligibility ? `**Eligibility:** ${program.eligibility}` : "",
        program?.career_roles?.length ? `**Career roles:** ${program.career_roles.slice(0, 3).join(", ")}` : ""
      ])
    },
    ASK_ELIGIBILITY: {
      heading: "Eligibility Details",
      intro: program
        ? `Here are the main **eligibility details** for the **${program.name}**.`
        : `Here are the main **eligibility details** to review.`,
      bullets: dedupe([
        program?.eligibility ? `**Eligibility:** ${program.eligibility}` : "",
        program?.start_date ? `**Upcoming batch:** ${program.start_date}` : ""
      ])
    },
    ASK_ADMISSION: {
      heading: "Admission Details",
      intro: `I have shared the main **admission and next-step details** below.`,
      bullets: dedupe([
        program?.start_date ? `**Upcoming batch:** ${program.start_date}` : "",
        program?.fees?.seat_booking ? `**Seat booking amount:** ${program.fees.seat_booking}` : ""
      ])
    },
    ASK_FACULTY: {
      heading: "Faculty Highlights",
      intro: `Here are the main **faculty highlights** you may want to review.`,
      bullets: dedupe([
        faculty?.top_institutions?.length ? `**Faculty exposure:** ${safeJoin(faculty.top_institutions, 3)}` : ""
      ])
    },
    ASK_GLOBAL: {
      heading: "Global Exposure",
      intro: `Here are the main **global exposure details** available.`,
      bullets: dedupe([
        program?.global_exposure?.length ? `**Program exposure:** ${safeJoin(program.global_exposure, 4)}` : "",
        institute?.global_presence?.length ? `**Institution reach:** ${safeJoin(institute.global_presence, 5)}` : ""
      ])
    },
    SESSION: {
      heading: "Class Schedule and Format",
      intro: program
        ? `Here are the main **schedule and format details** for the **${program.name}**.`
        : `Here are the main **schedule and format details** available.`,
      bullets: dedupe([
        program?.format ? `**Format:** ${program.format}` : "",
        program?.duration ? `**Duration:** ${program.duration}` : "",
        program?.start_date ? `**Batch timing:** ${program.start_date}` : ""
      ])
    },
    IRRELEVANT: {
      heading: "How I Can Help",
      intro: `I can help with **programs**, **fees**, **eligibility**, **admissions**, and **placements** related to Charters Union of Business.`,
      bullets: dedupe([
        "**Programs:** MBA, PGDM, and Executive MBA",
        "**Fees and EMI:** payment support and scholarship details",
        "**Admissions:** eligibility, process, and next-step guidance",
        "**Placements:** career outcomes and recruiter-related information"
      ])
    },
    OTHER: {
      heading: "Key Details",
      intro: program
        ? `I have shared the most relevant **program details** for the **${program.name}** below.`
        : `I have shared the most relevant **program details** below.`,
      bullets: dedupe([
        program?.duration ? `**Duration:** ${program.duration}` : "",
        program?.format ? `**Format:** ${program.format}` : "",
        program?.fees?.emi_start ? `**EMI starts from:** ${program.fees.emi_start}` : "",
        placement.average_ctc ? `**Average CTC:** ${placement.average_ctc}` : ""
      ])
    }
  };

  return map[intent] || map.OTHER;
}

function resolveQuestionInsight(intent, program, question) {
  const requestedIntent = safeText(intent || "OTHER").toUpperCase() || "OTHER";
  const requestedInsight = getQuestionInsight(requestedIntent, program, question);
  const minBulletCount = ["ASK_ADMISSION", "ASK_FACULTY", "ASK_GLOBAL"].includes(requestedIntent) ? 1 : 2;
  const hasAnswerData = requestedIntent !== "IRRELEVANT" && requestedInsight.bullets.length >= minBulletCount;

  if (hasAnswerData) {
    return {
      intent: requestedIntent,
      insight: requestedInsight,
      hasAnswerData: true,
      usedFallback: false
    };
  }

  return {
    intent: "IRRELEVANT",
    insight: getQuestionInsight("IRRELEVANT", program, question),
    hasAnswerData: false,
    usedFallback: true
  };
}

function getIntentTopic(intent) {
  const topics = {
    ASK_DURATION: "duration and format",
    ASK_FEE: "fees and payment options",
    ASK_PLACEMENT: "placements and outcomes",
    ASK_PROGRAM: "program structure",
    ASK_ELIGIBILITY: "eligibility",
    ASK_ADMISSION: "admissions",
    ASK_FACULTY: "faculty",
    ASK_GLOBAL: "global exposure",
    SESSION: "schedule and class format"
  };

  return topics[intent] || "program details";
}

function buildQuestionFollowupIntro({ firstName, session, insight, intent, program, aiIntro }) {
  const topic = getIntentTopic(intent);
  const programName = safeText(program?.name);
  const factualIntro = insight.intro;
  const personalizedAiIntro = compactIntro(aiIntro);

  if (session >= 3) {
    return personalizedAiIntro || `${firstName}, this is a final follow-up on your question about **${topic}**${programName ? ` for the **${programName}**` : ""}. I have kept the key answer and next-step details together for quick review.`;
  }

  return personalizedAiIntro || `${firstName}, following up on your question about **${topic}**${programName ? ` for the **${programName}**` : ""}, I have shared the main answer and a few related points students usually review next.`;
}

function buildIntroBullets(seed) {
  return dedupe([
    faculty?.top_institutions?.length ? `**Faculty exposure:** ${safeJoin(faculty.top_institutions, 4)}` : "",
    institute?.global_presence?.length ? `**Global presence:** ${safeJoin(institute.global_presence, 5)}` : "",
    "**Placement rate:** 95%",
    pickVariant([
      home?.placement_highlights?.average_ctc ? `**Average CTC:** ${home.placement_highlights.average_ctc}` : "",
      home?.placement_highlights?.highest_ctc ? `**Highest CTC:** ${home.placement_highlights.highest_ctc}` : "",
      home?.placement_highlights?.recruiters ? `**Recruiters:** ${home.placement_highlights.recruiters}` : ""
    ].filter(Boolean), seed)
  ]).slice(0, 4);
}

function buildFollowupBullets({ session, viewerLevel, program, question, intent, seed }) {
  if (question) {
    const insight = getQuestionInsight(intent, program, question);
    const placement = getPlacement(program);

    if (intent === "IRRELEVANT") {
      return insight.bullets.slice(0, 4);
    }

    if (session >= 3) {
      return dedupe([
        ...insight.bullets.slice(0, 1),
        program?.start_date ? `**Next batch:** ${program.start_date}` : "",
        program?.fees?.seat_booking ? `**Seat booking amount:** ${program.fees.seat_booking}` : "",
        program?.fees?.scholarship ? `**Scholarship support:** ${program.fees.scholarship}` : "",
        placement.average_ctc ? `**Average CTC:** ${placement.average_ctc}` : "",
        "**Next step:** if this program is still under review, this is the right time to complete the next action"
      ]).slice(0, 4);
    }

    return dedupe([
      ...insight.bullets.slice(0, 2),
      program?.start_date ? `**Next batch:** ${program.start_date}` : "",
      program?.fees?.emi_start ? `**EMI starts from:** ${program.fees.emi_start}` : "",
      placement.average_ctc ? `**Average CTC:** ${placement.average_ctc}` : "",
      placement.placement_rate ? `**Placement rate:** ${placement.placement_rate}` : "",
      faculty?.top_institutions?.length ? `**Faculty exposure:** ${safeJoin(faculty.top_institutions, 3)}` : "",
      institute?.global_presence?.length ? `**Global presence:** ${safeJoin(institute.global_presence, 4)}` : "",
      viewerLevel === "HOT" ? "**Next step:** you can review the program page and apply when ready" : ""
    ]).slice(0, 4);
  }

  const placement = getPlacement(program);

  if (session === 1) {
    return dedupe([
      faculty?.top_institutions?.length ? `**Faculty network:** ${safeJoin(faculty.top_institutions, 4)}` : "",
      institute?.global_presence?.length ? `**Global exposure:** ${safeJoin(institute.global_presence, 5)}` : "",
      program?.fees?.emi_start ? `**EMI starts from:** ${program.fees.emi_start}` : "",
      program?.duration ? `**Program duration:** ${program.duration}` : "",
      pickVariant([
        "**Career support:** mentoring and placement guidance",
        "**Learning format:** practical and industry-led",
        "**Student support:** admissions guidance and program assistance",
        "**Program fit:** designed for career-focused learners"
      ], seed)
    ]).slice(0, 4);
  }

  if (session === 2) {
    return dedupe([
      placement.average_ctc ? `**Average CTC:** ${placement.average_ctc}` : "",
      placement.salary_range ? `**Salary range:** ${placement.salary_range}` : "",
      placement.salary_growth ? `**Salary growth:** ${placement.salary_growth}` : "",
      placement.placement_rate ? `**Placement rate:** ${placement.placement_rate}` : ""
    ]).slice(0, 4);
  }

  return dedupe([
    program?.start_date ? `**Upcoming batch:** ${program.start_date}` : "",
    program?.fees?.scholarship ? `**Scholarship support:** ${program.fees.scholarship}` : "",
    program?.fees?.seat_booking ? `**Seat booking amount:** ${program.fees.seat_booking}` : "",
    viewerLevel === "HOT"
      ? "**Next step:** if the program fits your goal, this is the right time to complete the application step"
      : viewerLevel === "WARM"
        ? "**Next step:** this is a good time to review the final details and shortlist the program"
        : "**Next step:** if the program still interests you, review the details once more and decide"
  ]).slice(0, 4);
}

async function tryAiVariation(prompt, fallback, maxWords = 36) {
  try {
    const raw = await askAI(prompt, 180);
    const clean = safeText(raw).replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    const heading = safeText(parsed.heading) || fallback.heading;
    const intro = compactIntro(parsed.intro);

    if (!intro || intro.split(/\s+/).length > maxWords) {
      return fallback;
    }

    return { heading, intro };
  } catch (_) {
    return fallback;
  }
}

async function getIntroContent(name, viewerLevel = "NO_ACTIVITY", email = "") {
  const viewer = getViewerProfile(viewerLevel);
  const firstName = titleCase(name || "there").split(" ")[0];
  const seed = buildSeed([name, email, viewerLevel, "INTRO"]);

  const fallback = {
    heading: pickVariant([
      "A Quick Program Overview",
      "Programs Built for Career Growth",
      "A Better Look at Our Programs"
    ], seed),
    intro: pickVariant([
      `${firstName}, **Charters Union of Business** offers **industry-led programs** with clear career outcomes. I am sharing a short overview to help you compare the options quickly.`,
      `${firstName}, **Charters Union of Business** is focused on **career growth** and practical learning. Below is a short overview with the main points students usually review first.`,
      `${firstName}, if you are exploring business programs, **Charters Union of Business** offers a practical path with **placement-focused learning**. I have kept the overview short and easy to scan.`
    ], seed)
  };

  const prompt = `
You are Priya Sharma, an admissions counselor at Charters Union of Business.

Return JSON only:
{
  "heading": "short heading",
  "intro": "exactly two short sentences, under 32 words total, factual and natural"
}

Constraints:
- Mention "Charters Union of Business".
- Tone: ${viewer.tone}
- No placeholders.
- Do not invent any statistics or claims.
`;

  const ai = await tryAiVariation(prompt, fallback, 32);

  return {
    tag: "INTRO",
    heading: ai.heading,
    intro: ai.intro,
    stats: getProgramStats(null),
    bullets: buildIntroBullets(seed),
    programs: buildProgramList(seed)
  };
}

async function getFollowupContent(name, course, viewerLevel = "NO_ACTIVITY", session = 1, question = null, email = "") {
  const normalizedQuestion = cleanQuestion(question);
  const inferredProgram = findProgram(normalizedQuestion) || findProgram(course);
  const viewer = getViewerProfile(viewerLevel);
  const detectedIntent = normalizedQuestion
    ? String(await detectIntent(normalizedQuestion) || "OTHER").toUpperCase()
    : "OTHER";
  const seed = buildSeed([name, email, course, viewerLevel, session, normalizedQuestion]);
  const firstName = titleCase(name || "there").split(" ")[0];
  const resolvedQuestion = resolveQuestionInsight(detectedIntent, inferredProgram, normalizedQuestion);
  const intent = resolvedQuestion.intent;
  const insight = resolvedQuestion.insight;

  let fallback;

  if (normalizedQuestion) {
    fallback = {
      heading: pickVariant([
        resolvedQuestion.usedFallback ? "How I Can Help" : "Your Question, Answered Clearly",
        insight.heading,
        "Here Are the Key Details",
        `More on ${titleCase(getIntentTopic(intent))}`
      ], seed),
      intro: resolvedQuestion.usedFallback
        ? `${firstName}, I could not find that exact detail in our current records. I have shared the main areas I can help with from Charters Union of Business below.`
        : `${firstName}, thanks for your question. Here is a brief answer first, followed by a few additional details from Charters Union of Business that may help with your decision.`
    };
  } else if (session === 1) {
    fallback = {
      heading: pickVariant([
        "A Short Follow-Up",
        "A Better Look at the Program",
        "Why Students Review Us Closely"
      ], seed),
      intro: `${firstName}, I wanted to share a quick follow-up from Charters Union of Business. These are the main points students usually review early.`
    };
  } else if (session === 2) {
    fallback = {
      heading: pickVariant([
        "A Closer Look at Outcomes",
        "Career Outcome Highlights",
        "A Quick ROI Snapshot"
      ], seed),
      intro: `${firstName}, here is a short follow-up focused on the main outcome details from Charters Union of Business. I have kept it brief and practical.`
    };
  } else {
    fallback = {
      heading: pickVariant([
        normalizedQuestion ? "Important Final Details" : "Final Key Details",
        normalizedQuestion ? "Final Next-Step Information" : "Important Next-Step Details",
        normalizedQuestion ? "Final Follow-Up on Your Question" : "A Quick Last Look"
      ], seed),
      intro: normalizedQuestion
        ? `${firstName}, I wanted to send one final follow-up based on your question. Along with the brief answer, I have included the main next-step details that may help you decide.`
        : viewerLevel === "HOT"
          ? `${firstName}, this is a final follow-up from Charters Union of Business. Based on your strong interest, these are the main details to review before completing the next step.`
          : viewerLevel === "WARM"
            ? `${firstName}, this is a final follow-up from Charters Union of Business. These are the main details to review if you are close to shortlisting the program.`
            : viewerLevel === "COLD"
              ? `${firstName}, this is a final follow-up from Charters Union of Business. I have kept the main details here in case you would like one last quick review.`
          : `${firstName}, I wanted to send one final short follow-up from Charters Union of Business. These are the main next-step details you may want to review.`
    };
  }

  const prompt = `
You are Priya Sharma, Admissions Counselor at Charters Union of Business.

Return JSON only:
{
  "heading": "short heading",
  "intro": "exactly two short sentences, under 34 words total, factual and natural"
}

Context:
- Session: ${session}
- Viewer level: ${viewerLevel}
- Question: ${normalizedQuestion || "none"}
- Course: ${course || "not specified"}
- Tone: ${viewer.tone}
- Do not invent any statistics or urgency.
`;

  const ai = await tryAiVariation(prompt, fallback, 34);

  return {
    tag: normalizedQuestion ? "FOLLOWUP_QUESTION" : "FOLLOWUP",
    heading: ai.heading,
    intro: normalizedQuestion
      ? resolvedQuestion.usedFallback
        ? fallback.intro
        : buildQuestionFollowupIntro({
          firstName,
          session,
          insight,
          intent,
          program: inferredProgram,
          aiIntro: ai.intro
        })
      : ai.intro,
    stats: resolvedQuestion.usedFallback ? [] : getProgramStats(inferredProgram),
    program: resolvedQuestion.usedFallback ? null : summarizeProgram(inferredProgram),
    bullets: buildFollowupBullets({
      session,
      viewerLevel,
      program: inferredProgram,
      question: normalizedQuestion,
      intent,
      seed
    })
  };
}

async function getReplyContent(userMessage, intent = "OTHER", options = {}) {
  const normalizedIntent = safeText(intent || "OTHER").toUpperCase() || "OTHER";
  const question = cleanQuestion(userMessage);
  const program = findProgram(question) || findProgram(options.course);
  const resolvedQuestion = resolveQuestionInsight(normalizedIntent, program, question);
  const insight = resolvedQuestion.insight;
  const seed = buildSeed([options.userKey, options.email, question, normalizedIntent]);
  const firstName = titleCase(options.name || "there").split(" ")[0];

  const fallback = {
    heading: pickVariant([
      resolvedQuestion.usedFallback ? "How I Can Help" : "Answering Your Question",
      insight.heading,
      "Here Are the Main Details"
    ], seed),
    intro: resolvedQuestion.usedFallback
      ? `${firstName}, I could not find that exact detail in our current records. I can best help with Charters Union of Business program-related queries, so I have shared the relevant areas below.`
      : normalizedIntent === "IRRELEVANT"
      ? `${firstName}, thank you for your message. I can best help with Charters Union of Business program-related queries, so I have shared the relevant areas below.`
      : `${firstName}, thanks for reaching out. I have shared the most relevant details from Charters Union of Business below.`
  };

  const prompt = `
You are Priya Sharma from Charters Union of Business.

Return JSON only:
{
  "heading": "short heading",
  "intro": "exactly two short sentences, under 34 words total, factual and natural"
}

Context:
- Intent: ${normalizedIntent}
- Question: ${question}
- Do not invent any statistics or claims.
`;

  const ai = await tryAiVariation(prompt, fallback, 34);

  return {
    tag: `REPLY_${resolvedQuestion.intent}`,
    heading: ai.heading,
    intro: resolvedQuestion.usedFallback ? fallback.intro : (insight.intro || ai.intro),
    stats: resolvedQuestion.usedFallback ? [] : getProgramStats(program),
    program: resolvedQuestion.usedFallback ? null : summarizeProgram(program),
    bullets: insight.bullets.slice(0, 4)
  };
}

async function buildReplyContent(userMessage, intent = "OTHER", options = {}) {
  return getReplyContent(userMessage, intent, options);
}

module.exports = {
  getIntroContent,
  getFollowupContent,
  getReplyContent,
  buildReplyContent
};
