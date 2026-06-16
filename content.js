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

function getLatestAnswer() {
  const selectors = SELECTORS[SITE] || SELECTORS.perplexity;

  for (const selector of selectors) {
    const nodes = document.querySelectorAll(selector);
    if (nodes.length > 0) {
      return nodes[nodes.length - 1].innerText.trim();
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

console.log(`[Live Workspace] Watching: ${SITE}`);

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
