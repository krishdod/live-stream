importScripts("config.js");

const HTTP_ENDPOINT = `${SERVER_URL}/answer`;

function sendAnswer(text) {
  return fetch(HTTP_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  })
    .then((response) => ({ sent: response.ok }))
    .catch((err) => {
      console.error("[Live Workspace] SEND FAILED", err);
      return { sent: false };
    });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "answer" || typeof msg.text !== "string") {
    return;
  }

  sendAnswer(msg.text).then(sendResponse);
  return true;
});
