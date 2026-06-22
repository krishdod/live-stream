console.log("[Live Workspace] Extension loaded on:", location.href);

const SITE = location.hostname.includes("chatgpt") || location.hostname.includes("openai")
  ? "chatgpt"
  : "perplexity";

const SELECTORS = {
  perplexity: [
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

let previousAnswer = "";

function isMarkerOnly(text) {
  return /^[•*·.\-\s]+$/u.test(text);
}

function normalizeBulletText(text) {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(\*+|•|·|-)\s*/, "");
}

function flattenMarkerRows(root) {
  root.querySelectorAll("div, li").forEach((row) => {
    const kids = [...row.children];
    if (kids.length < 2) return;

    const marker = kids[0].innerText.trim();
    if (!isMarkerOnly(marker)) return;

    const content = kids.slice(1).map((k) => normalizeBulletText(k.innerText)).filter(Boolean).join(" ");
    if (!content) return;

    row.textContent = `• ${content}`;
  });
}

function flattenListItem(li) {
  const paragraphs = li.querySelectorAll("p");
  let text = "";

  if (paragraphs.length) {
    text = [...paragraphs]
      .map((p) => normalizeBulletText(p.innerText))
      .filter(Boolean)
      .join(" ");
  } else {
    text = normalizeBulletText(li.innerText);
  }

  return text ? `• ${text}` : "";
}

function cleanupExtractedText(text) {
  return text
    .replace(/\n[ \t]*[•*·.\-][ \t]*\n[ \t]*/g, "\n• ")
    .replace(/^\s*[•*·.\-][ \t]*$/gm, "")
    .replace(/^\s*[*•\-]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractFormattedText(el) {
  const clone = el.cloneNode(true);
  flattenMarkerRows(clone);

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

      if (tag === "p" || tag === "blockquote" || tag === "pre") {
        const text = normalizeBulletText(child.innerText);
        if (text && !isMarkerOnly(text)) blocks.push(text);
        continue;
      }

      if (child.children.length) {
        walk(child);
      } else {
        const text = normalizeBulletText(child.innerText);
        if (text && !isMarkerOnly(text)) blocks.push(text);
      }
    }
  };

  walk(clone);

  if (!blocks.length) {
    return cleanupExtractedText(clone.innerText);
  }

  return cleanupExtractedText(blocks.join("\n\n"));
}

function getLatestAnswer() {
  if (SITE === "perplexity") {
    const answers = document.querySelectorAll('div[id^="markdown-content-"]');
    if (answers.length) {
      const prose = answers[answers.length - 1].querySelector(".prose");
      if (prose) return extractFormattedText(prose);
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

console.log(`[Live Workspace] Watching: ${SITE} (extractor v2)`);

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
  checkAnswer("poll");
}, 300);
