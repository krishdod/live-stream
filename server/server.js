const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8765;
const viewerPath = path.join(__dirname, "viewer.html");

const STREAM_KEY = process.env.STREAM_KEY || "";
const EDIT_KEY = process.env.EDIT_KEY || "";
const VIEW_KEY = process.env.VIEW_KEY || "";

let lastAnswer = "";

function securityEnabled() {
  return Boolean(STREAM_KEY || EDIT_KEY || VIEW_KEY);
}

function validateRole(role, key) {
  if (!securityEnabled()) {
    return { ok: true, role: role === "view" ? "view" : "edit" };
  }

  if (role === "edit" && EDIT_KEY && key === EDIT_KEY) {
    return { ok: true, role: "edit" };
  }

  if (role === "view" && VIEW_KEY && key === VIEW_KEY) {
    return { ok: true, role: "view" };
  }

  return { ok: false, role: null };
}

function validateStreamKey(key) {
  if (!STREAM_KEY) return true;
  return key === STREAM_KEY;
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function parseQuery(url) {
  const query = url.includes("?") ? url.slice(url.indexOf("?")) : "";
  return new URLSearchParams(query);
}

const server = http.createServer((req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const pathname = req.url.split("?")[0];

  if (pathname === "/" || pathname === "/viewer") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(fs.readFileSync(viewerPath));
    return;
  }

  if (pathname === "/api/share-links" && req.method === "GET") {
    const params = parseQuery(req.url);
    const auth = validateRole(params.get("role"), params.get("key"));

    if (!auth.ok || auth.role !== "edit") {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden" }));
      return;
    }

    const host = req.headers.host || `localhost:${PORT}`;
    const proto = req.headers["x-forwarded-proto"] || "http";
    const base = `${proto}://${host}`;

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      viewLink: `${base}/?role=view&key=${encodeURIComponent(VIEW_KEY)}`,
      editLink: `${base}/?role=edit&key=${encodeURIComponent(EDIT_KEY)}`,
      secured: securityEnabled()
    }));
    return;
  }

  if (pathname === "/auth" && req.method === "GET") {
    const params = parseQuery(req.url);
    const role = params.get("role");
    const key = params.get("key");
    const result = validateRole(role, key);

    res.writeHead(result.ok ? 200 : 403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: result.ok,
      role: result.role,
      secured: securityEnabled()
    }));
    return;
  }

  if (pathname === "/answer" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
      if (body.length > 2_000_000) req.destroy();
    });

    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const text = typeof parsed.text === "string" ? parsed.text : null;
        const key = typeof parsed.key === "string" ? parsed.key : "";

        if (!validateStreamKey(key)) {
          res.writeHead(403, { "Content-Type": "text/plain" });
          res.end("Forbidden");
          return;
        }

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

wss.on("connection", (ws, req) => {
  const params = parseQuery(req.url || "");
  const auth = validateRole(params.get("role"), params.get("key"));

  if (!auth.ok) {
    ws.close(1008, "Unauthorized");
    return;
  }

  ws.role = auth.role;

  ws.send(JSON.stringify({ type: "auth", role: auth.role }));

  if (lastAnswer) {
    ws.send(JSON.stringify({ type: "answer", text: lastAnswer }));
  }

  ws.on("message", (raw) => {
    if (ws.role !== "edit") return;

    try {
      const msg = JSON.parse(raw);

      if (msg.type === "answer" && typeof msg.text === "string") {
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
  if (securityEnabled()) {
    console.log("Access control: enabled");
  }
});
