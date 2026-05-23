function safeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanCourse(course) {
  const value = safeText(course);
  return value || "Our Business Programs";
}

function pickBySeed(items, seedText) {
  const text = safeText(seedText) || "subject";
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }

  return items[Math.abs(hash) % items.length];
}

function buildIntroSubject({ viewerLevel = "NO_ACTIVITY", name = "", course = "" } = {}) {
  const target = cleanCourse(course);
  const seed = `${viewerLevel}|${name}|${target}|intro`;

  const pools = {
    HOT: [
      `${target}: Details You May Want to Review`,
      `A Quick Next-Step Note on ${target}`,
      `${target}: Information for Your Review`
    ],
    WARM: [
      `${target}: A Brief Overview`,
      `A Closer Look at ${target}`,
      `${target}: Key Details to Review`
    ],
    COLD: [
      `Information on ${target}`,
      `${target}: Program Details`,
      `A Quick Overview of ${target}`
    ],
    NO_ACTIVITY: [
      `A Quick Introduction to Charters Union of Business`,
      `Information from Charters Union of Business`,
      `A Brief Overview of Our Business Programs`
    ]
  };

  return pickBySeed(pools[viewerLevel] || pools.NO_ACTIVITY, seed);
}

function buildFollowupSubject({ session = 1, viewerLevel = "NO_ACTIVITY", question = "", course = "" } = {}) {
  const target = cleanCourse(course);
  const cleanQuestionText = safeText(question);
  const seed = `${session}|${viewerLevel}|${cleanQuestionText}|${target}|followup`;

  if (cleanQuestionText) {
    const questionPools = session <= 1
      ? [
          `Regarding Your Question on ${target}`,
          `Details for Your Question on ${target}`,
          `Answering Your Question on ${target}`
        ]
      : session === 3
        ? [
            `Final Follow-Up on Your Question About ${target}`,
            `Final Details Related to ${target}`,
            `Important Next Steps for ${target}`
          ]
      : [
          `Following Up on Your Question About ${target}`,
          `Additional Details on ${target}`,
          `More Information on ${target}`
        ];

    return pickBySeed(questionPools, seed);
  }

  const bySession = {
    1: {
      HOT: [
        `${target}: Details for Your Review`,
        `A Quick Follow-Up on ${target}`,
        `${target}: Points to Consider`
      ],
      WARM: [
        `${target}: What to Review Next`,
        `A Better Look at ${target}`,
        `${target}: A Short Follow-Up`
      ],
      COLD: [
        `A Short Note on ${target}`,
        `${target}: Main Program Details`,
        `A Quick Look at ${target}`
      ],
      NO_ACTIVITY: [
        `A Short Follow-Up from Charters Union of Business`,
        `A Quick Look at Our Programs`,
        `A Brief Note on Our Business Programs`
      ]
    },
    2: {
      HOT: [
        `${target}: Outcome and Next-Step Details`,
        `Important Details on ${target}`,
        `${target}: What to Review Now`
      ],
      WARM: [
        `${target}: Career Outcome Highlights`,
        `A Closer Look at ${target} Outcomes`,
        `${target}: Outcome Details`
      ],
      COLD: [
        `${target}: Key Outcome Information`,
        `What to Know About ${target}`,
        `${target}: Additional Highlights`
      ],
      NO_ACTIVITY: [
        `Additional Details from Charters Union of Business`,
        `A Closer Look at Program Outcomes`,
        `More Information on Our Programs`
      ]
    },
    3: {
      HOT: [
        `${target}: Final Decision Details`,
        `${target}: Final Application Steps`,
        `Final Steps to Move Ahead with ${target}`
      ],
      WARM: [
        `${target}: Important Final Details`,
        `${target}: Review Before the Next Step`,
        `Final Highlights of ${target}`
      ],
      COLD: [
        `${target}: A Final Look`,
        `Final Highlights of ${target}`,
        `${target}: Key Details to Review`
      ],
      NO_ACTIVITY: [
        `Important Final Details from Charters Union of Business`,
        `A Final Note on Our Programs`,
        `Final Information for Your Review`
      ]
    }
  };

  const sessionPool = bySession[session] || bySession[2];
  return pickBySeed(sessionPool[viewerLevel] || sessionPool.NO_ACTIVITY, seed);
}

function buildReplySubject(originalSubject = "") {
  const clean = safeText(originalSubject);
  return clean ? `Re: ${clean}` : "Re: Your Enquiry";
}

module.exports = {
  buildIntroSubject,
  buildFollowupSubject,
  buildReplySubject
};
