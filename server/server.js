const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8765;
const viewerPath = path.join(__dirname, "viewer.html");
const faviconPath = path.join(__dirname, "favicon.png");

let lastAnswer = "";

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const server = http.createServer((req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/favicon.png" || req.url === "/favicon.ico") {
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(fs.readFileSync(faviconPath));
    return;
  }

  if (req.url === "/" || req.url === "/viewer") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(fs.readFileSync(viewerPath));
    return;
  }

  if (req.url === "/answer" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
      if (body.length > 2_000_000) req.destroy();
    });

    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const text = typeof parsed.text === "string" ? parsed.text : null;

        // Allow empty string to explicitly clear the viewer.
        if (text !== null) {
          lastAnswer = text;
          broadcast({ type: "answer", text }, null);
        }

        res.writeHead(204);
        res.end();
      } catch {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Bad JSON");
      }
    });

    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocket.Server({ server });

function broadcast(msg, sender) {
  const payload = JSON.stringify(msg);

  wss.clients.forEach((client) => {
    if ((sender == null || client !== sender) && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

wss.on("connection", (ws) => {
  if (lastAnswer) {
    ws.send(JSON.stringify({ type: "answer", text: lastAnswer }));
  }

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);

      if (msg.type === "answer" && msg.text) {
        lastAnswer = msg.text;
        broadcast(msg, ws);
      }
    } catch {
      // ignore malformed messages
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
