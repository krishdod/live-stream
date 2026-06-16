const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const nodemailer = require("nodemailer");

const PORT = process.env.PORT || 8765;
const viewerPath = path.join(__dirname, "viewer.html");

const STREAM_KEY = process.env.STREAM_KEY || "";
const EDIT_KEY = process.env.EDIT_KEY || "";
const VIEW_KEY = process.env.VIEW_KEY || "";

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const EMAIL_FROM = process.env.EMAIL_FROM || SMTP_USER || "noreply@liveworkspace.app";

let mailer = null;

if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  mailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

async function sendInviteEmail(to, role, link) {
  const roleLabel = role === "edit" ? "Editor" : "Viewer";
  const subject = "You've been invited to Live Workspace";
  const text =
    `You've been invited to collaborate on Live Workspace as ${roleLabel}.\n\n` +
    `Open this link:\n${link}\n\n` +
    `Anyone with this link can ${role === "edit" ? "edit" : "view"} the workspace.`;

  const html =
    `<p>You've been invited to collaborate on <strong>Live Workspace</strong> as <strong>${roleLabel}</strong>.</p>` +
    `<p><a href="${link}">Open Live Workspace</a></p>` +
    `<p style="color:#666;font-size:13px">Or copy this link:<br>${link}</p>`;

  await mailer.sendMail({ from: EMAIL_FROM, to, subject, text, html });
}

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

  if (pathname === "/api/send-invite" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });

    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const auth = validateRole(parsed.role, parsed.key);

        if (!auth.ok || auth.role !== "edit") {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Forbidden" }));
          return;
        }

        const email = typeof parsed.email === "string" ? parsed.email.trim() : "";
        const linkRole = parsed.linkRole === "edit" ? "edit" : "view";

        if (!email || !email.includes("@")) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid email" }));
          return;
        }

        const host = req.headers.host || `localhost:${PORT}`;
        const proto = req.headers["x-forwarded-proto"] || "http";
        const base = `${proto}://${host}`;
        const link =
          linkRole === "edit"
            ? `${base}/?role=edit&key=${encodeURIComponent(EDIT_KEY)}`
            : `${base}/?role=view&key=${encodeURIComponent(VIEW_KEY)}`;

        if (!mailer) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: "Email not configured",
            mailto: `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Live Workspace invite")}&body=${encodeURIComponent(`Open this link:\n${link}`)}`
          }));
          return;
        }

        await sendInviteEmail(email, linkRole, link);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to send email" }));
      }
    });

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
          broadcast({ type: "sync", text, from: "stream" }, null);
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

let clientCounter = 0;

wss.on("connection", (ws, req) => {
  const params = parseQuery(req.url || "");
  const auth = validateRole(params.get("role"), params.get("key"));

  if (!auth.ok) {
    ws.close(1008, "Unauthorized");
    return;
  }

  ws.role = auth.role;
  ws.clientId = `c${++clientCounter}`;

  ws.send(JSON.stringify({ type: "auth", role: auth.role, clientId: ws.clientId }));

  if (lastAnswer) {
    ws.send(JSON.stringify({ type: "sync", text: lastAnswer, from: "server" }));
  }

  ws.on("message", (raw) => {
    if (ws.role !== "edit") return;

    try {
      const msg = JSON.parse(raw);

      if (msg.type === "sync" && typeof msg.text === "string") {
        lastAnswer = msg.text;
        msg.clientId = ws.clientId;
        broadcast(msg, ws);
      }

      if (msg.type === "selection" && typeof msg.start === "number") {
        msg.clientId = ws.clientId;
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
