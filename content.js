console.log("[Perplexity Live Stream] Extension loaded on:", location.href);

const ANSWER_SELECTOR = 'div.prose[data-renderer="lm"]';
const ANSWER_FALLBACK = "div.prose[data-renderer]";

let previousAnswer = "";

function getLatestAnswer() {
  let answers = document.querySelectorAll(ANSWER_SELECTOR);

  if (answers.length === 0) {
    answers = document.querySelectorAll(ANSWER_FALLBACK);
  }

  if (answers.length === 0) {
    return "";
  }

  return answers[answers.length - 1].innerText.trim();
}

function sendAnswer(text) {
  chrome.runtime.sendMessage({ type: "answer", text }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("[Perplexity Live Stream] SEND FAILED", chrome.runtime.lastError.message);
    }
  });
}

function checkAnswer(source) {
  const answer = getLatestAnswer();

  if (answer && answer !== previousAnswer) {
    previousAnswer = answer;
    console.log(`[Perplexity Live Stream] ANSWER CHANGED (${source})`);
    sendAnswer(answer);
  }
}

const initialMatches = document.querySelectorAll(ANSWER_SELECTOR).length;
console.log(
  `[Perplexity Live Stream] Found ${initialMatches} answer element(s) on load`
);

const initialAnswer = getLatestAnswer();
if (initialAnswer) {
  previousAnswer = initialAnswer;
  sendAnswer(initialAnswer);
} else {
  console.log("[Perplexity Live Stream] No answer yet — ask a question to test");
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
