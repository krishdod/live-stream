console.log("[Live Workspace] Extension loaded on:", location.href);

const SITE = location.hostname.includes("chatgpt") || location.hostname.includes("openai")
  ? "chatgpt"
  : "perplexity";

const SELECTORS = {
  perplexity: [
    'div[id^="markdown-content-"] .prose',
    'div.prose[data-renderer="lm"]',
    "div.prose[data-renderer]"
  ],
  chatgpt: [
    '[data-message-author-role="assistant"] .markdown',
    '[data-message-author-role="assistant"]',
    'article[data-turn="assistant"] .markdown',
    'article[data-turn="assistant"]'
  ]
};

const MARKER_RE = /^[•*·∙●◦.\-]+$/u;
const MARKER_PREFIX_RE = /^[•*·∙●◦.\-]\s*/u;

let previousAnswer = "";
let lastExtractedLen = 0;
let stableTicks = 0;

function isMarkerOnly(text) {
  return MARKER_RE.test(text.trim());
}

function mergeOrphanBullets(text) {
  const lines = text.split("\n");
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (isMarkerOnly(trimmed)) {
      while (i + 1 < lines.length && !lines[i + 1].trim()) i++;
      if (i + 1 < lines.length) {
        const next = lines[++i].trim();
        if (next) {
          out.push(`• ${next.replace(MARKER_PREFIX_RE, "")}`);
        }
      }
      continue;
    }

    if (!trimmed) {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      continue;
    }

    const line = trimmed.replace(MARKER_PREFIX_RE, "• ");
    out.push(line.startsWith("• ") ? line : line);
  }

  return out
    .join("\n")
    .replace(/^•\s*\n+([^\n])/gm, "• $1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function joinProseChunks(chunks) {
  return chunks.reduce((acc, chunk) => {
    const part = chunk.trim();
    if (!part) return acc;
    if (!acc) return part;
    if (/[.!?:]\s*$/.test(acc) || /^[•\-\*]/.test(part) || /^[A-Z]/.test(part)) {
      return `${acc}\n\n${part}`;
    }
    return acc + part;
  }, "");
}

function stripAnswerChrome(root) {
  root.querySelectorAll(
    "button, form, nav, aside, [class*='citation'], [class*='Citation'], [class*='source'], [class*='follow-up'], [class*='FollowUp']"
  ).forEach((node) => node.remove());
}

function extractFromPerplexityContainer(container) {
  const clone = container.cloneNode(true);
  stripAnswerChrome(clone);

  const proses = [...clone.querySelectorAll(".prose")];
  const text = proses.length
    ? joinProseChunks(proses.map((node) => node.innerText))
    : clone.innerText;

  return mergeOrphanBullets(text);
}

function extractFormattedText(el) {
  return mergeOrphanBullets(el.innerText);
}

function getLatestAnswer() {
  if (SITE === "perplexity") {
    const answers = document.querySelectorAll('div[id^="markdown-content-"]');
    if (answers.length) {
      const container = answers[answers.length - 1];
      container.scrollIntoView({ block: "nearest" });
      return extractFromPerplexityContainer(container);
    }
  }

  const selectors = SELECTORS[SITE] || SELECTORS.perplexity;

  for (const selector of selectors) {
    const nodes = document.querySelectorAll(selector);
    if (nodes.length > 0) {
      return extractFormattedText(nodes[nodes.length - 1]);
    }
  }

  return "";
}

function sendAnswer(text) {
  fetch(`${SERVER_URL}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, key: STREAM_KEY || "" })
  }).catch((err) => {
    console.error("[Live Workspace] SEND FAILED", err);
  });
}

function checkAnswer(source) {
  const answer = getLatestAnswer();

  if (!answer || answer === previousAnswer) {
    return;
  }

  if (
    previousAnswer &&
    answer.length < previousAnswer.length * 0.3
  ) {
    sendAnswer("");
  }

  previousAnswer = answer;
  console.log(`[Live Workspace] ANSWER CHANGED (${source})`);
  sendAnswer(answer);
}

console.log(`[Live Workspace] Watching: ${SITE} (extractor v4)`);

const initialAnswer = getLatestAnswer();
if (initialAnswer) {
  previousAnswer = initialAnswer;
  sendAnswer(initialAnswer);
} else {
  console.log("[Live Workspace] No answer yet — ask a question to test");
}

const observer = new MutationObserver(() => {
  checkAnswer("mutation");
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true
});

setInterval(() => {
  const answer = getLatestAnswer();

  if (answer.length === lastExtractedLen) {
    stableTicks++;
    if (stableTicks === 5 && answer && answer !== previousAnswer) {
      checkAnswer("rescan");
    }
  } else {
    stableTicks = 0;
    lastExtractedLen = answer.length;
  }

  checkAnswer("poll");
}, 300);
