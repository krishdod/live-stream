console.log("[Live Workspace] Extension loaded on:", location.href);

const SITE = location.hostname.includes("chatgpt") || location.hostname.includes("openai")
  ? "chatgpt"
  : "perplexity";

const PERPLEXITY_CONTAINER_SELECTORS = [
  'div[id^="markdown-content-"]',
  '[data-testid="answer-content"]',
  '[data-testid="search-result"]'
];

const PERPLEXITY_PROSE_SELECTORS = [
  'div.prose[data-renderer="lm"]',
  'div.prose[data-renderer]',
  "div.prose"
];

const SELECTORS = {
  chatgpt: [
    '[data-message-author-role="assistant"] .markdown',
    '[data-message-author-role="assistant"]',
    'article[data-turn="assistant"] .markdown',
    'article[data-turn="assistant"]'
  ]
};

const MARKER_RE = /^[•*·∙●◦.\-]+$/u;
const MARKER_PREFIX_RE = /^[•*·∙●◦.\-]\s*/u;
const BLOCK_TAGS = new Set(["p", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6"]);

const LIVE_PUBLISH_MS = 120;

let previousAnswer = "";
let lastExtractedLen = 0;
let stableTicks = 0;
let liveTimer = null;
let lastPublishAt = 0;
let lastUrl = location.href;

function isMarkerOnly(text) {
  return MARKER_RE.test(text.trim());
}

function normalizeInlineText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function flattenListItem(li) {
  const parts = [...li.querySelectorAll("p")].map((p) =>
    normalizeInlineText(p.innerText).replace(MARKER_PREFIX_RE, "")
  ).filter(Boolean);

  const text = parts.length
    ? parts.join(" ")
    : normalizeInlineText(li.innerText).replace(MARKER_PREFIX_RE, "");

  return text ? `• ${text}` : "";
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
        if (next) out.push(`• ${next.replace(MARKER_PREFIX_RE, "")}`);
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

function shouldMergeBlocks(prev, next) {
  if (!prev || !next) return false;
  if (/[.!?:]["')\]]*\s*$/.test(prev)) return false;
  if (/^[•\-*]/.test(next)) return false;
  return true;
}

function joinBlocks(blocks) {
  const merged = [];

  for (const block of blocks) {
    const text = mergeOrphanBullets(block);
    if (!text) continue;

    if (merged.length && shouldMergeBlocks(merged[merged.length - 1], text)) {
      merged[merged.length - 1] += text;
    } else {
      merged.push(text);
    }
  }

  return merged.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function stripAnswerChrome(root) {
  root.querySelectorAll(
    "button, form, nav, aside, svg, [class*='citation'], [class*='Citation'], [class*='source'], [class*='follow-up'], [class*='FollowUp'], [class*='related']"
  ).forEach((node) => node.remove());
}

function extractStructuredBlocks(root) {
  const blocks = [];

  const walk = (node) => {
    for (const child of node.children) {
      const tag = child.tagName?.toLowerCase();

      if (tag === "ul" || tag === "ol") {
        const items = [];
        child.querySelectorAll(":scope > li").forEach((li) => {
          const line = flattenListItem(li);
          if (line) items.push(line);
        });
        if (items.length) blocks.push(items.join("\n"));
        continue;
      }

      if (tag === "li") continue;

      if (BLOCK_TAGS.has(tag)) {
        const text = normalizeInlineText(child.innerText);
        if (text && !isMarkerOnly(text)) blocks.push(text);
        continue;
      }

      if (child.children.length) walk(child);
    }
  };

  walk(root);
  return blocks;
}

function extractFromContainer(container) {
  const clone = container.cloneNode(true);
  stripAnswerChrome(clone);

  const blocks = extractStructuredBlocks(clone);
  if (blocks.length) return joinBlocks(blocks);

  return mergeOrphanBullets(clone.innerText);
}

function isSubstantialText(text) {
  return normalizeInlineText(text).length > 15;
}

function getPerplexityAnswerContainer() {
  for (const selector of PERPLEXITY_CONTAINER_SELECTORS) {
    const nodes = document.querySelectorAll(selector);
    if (nodes.length) return nodes[nodes.length - 1];
  }

  const thread = document.querySelector(
    'div[class*="threadContentWidth"], div.max-w-threadContentWidth, main, [role="main"]'
  );
  const scope = thread || document.body;

  for (const selector of PERPLEXITY_PROSE_SELECTORS) {
    const proses = [...scope.querySelectorAll(selector)].filter((el) =>
      isSubstantialText(el.innerText)
    );
    if (proses.length) {
      const prose = proses[proses.length - 1];
      return prose.closest('div[id^="markdown-content-"]') || prose;
    }
  }

  return null;
}

function getAnswerContainer() {
  if (SITE === "perplexity") {
    return getPerplexityAnswerContainer();
  }

  const selectors = SELECTORS[SITE] || SELECTORS.chatgpt;
  for (const selector of selectors) {
    const nodes = document.querySelectorAll(selector);
    if (nodes.length) return nodes[nodes.length - 1];
  }

  return null;
}

function getLatestAnswer() {
  const container = getAnswerContainer();
  if (!container) return "";

  container.scrollIntoView({ block: "nearest" });
  return extractFromContainer(container);
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

function queueLivePublish(source) {
  const answer = getLatestAnswer();
  if (!answer || answer === previousAnswer) return;

  const now = Date.now();
  const elapsed = now - lastPublishAt;

  clearTimeout(liveTimer);

  if (elapsed >= LIVE_PUBLISH_MS) {
    publishAnswer(source);
    lastPublishAt = Date.now();
    return;
  }

  liveTimer = setTimeout(() => {
    publishAnswer(source);
    lastPublishAt = Date.now();
  }, LIVE_PUBLISH_MS - elapsed);
}

function publishAnswer(source) {
  const answer = getLatestAnswer();

  if (!answer || answer === previousAnswer) return;

  if (previousAnswer && answer.length < previousAnswer.length * 0.3) {
    sendAnswer("");
  }

  previousAnswer = answer;
  console.log(`[Live Workspace] ANSWER CHANGED (${source}, ${answer.length} chars)`);
  sendAnswer(answer);
}

console.log(`[Live Workspace] Watching: ${SITE} (extractor v5.2 — live stream)`);

const initialAnswer = getLatestAnswer();
if (initialAnswer) {
  previousAnswer = initialAnswer;
  sendAnswer(initialAnswer);
  console.log(`[Live Workspace] Found existing answer (${initialAnswer.length} chars)`);
} else {
  console.log("[Live Workspace] Waiting for Perplexity answer — ask a question, then watch for ANSWER CHANGED logs");
}

const observer = new MutationObserver(() => {
  queueLivePublish("live");
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true
});

setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    previousAnswer = "";
    lastExtractedLen = 0;
    stableTicks = 0;
    console.log("[Live Workspace] New page — reset answer watch");
  }

  const answer = getLatestAnswer();

  if (answer.length === lastExtractedLen) {
    stableTicks++;
    if (stableTicks === 4 && answer && answer !== previousAnswer) {
      publishAnswer("final");
    }
  } else {
    stableTicks = 0;
    lastExtractedLen = answer.length;
    queueLivePublish("live");
  }
}, 150);
