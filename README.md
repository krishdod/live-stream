# Live Workspace

Stream live text from your browser to a teammate in real time.

```
Your chat page
      ↓
Chrome Extension detects text changes
      ↓
Sends to relay server
      ↓
Teammate sees same text live
```

## Project structure

```
live-workspace/
├── manifest.json      # Chrome extension manifest
├── content.js         # Watches the page for answer changes
├── background.js      # Sends text to the relay server
├── config.js          # Server URL (local or Render)
├── render.yaml        # Render deployment config
└── server/
    ├── server.js      # HTTP + WebSocket relay server
    ├── viewer.html    # Live viewer page for teammates
    └── package.json
```

## Requirements

- Google Chrome
- Node.js 18+ (for local server or Render deploy)

## 1. Install the Chrome extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the project folder
5. You should see **Live Workspace** enabled

## 2. Run locally (same network)

### Start the server

```powershell
cd server
npm install
npm start
```

The server runs at `http://localhost:8765`.

### Configure the extension

In `config.js`, set:

```js
const SERVER_URL = "http://localhost:8765";
```

Reload the extension at `chrome://extensions`.

### Share with a teammate on the same Wi‑Fi

1. Find your local IP:
   ```powershell
   ipconfig
   ```
2. Share: `http://YOUR-IP:8765` (e.g. `http://192.168.1.42:8765`)
3. Teammate opens that link in their browser

### Test

1. Open your chat page and ask a question
2. Open `http://localhost:8765` (or share your IP link with teammate)
3. The text should appear live as it generates

## 3. Deploy to Render (remote teammates)

Use this when your teammate is **not on the same network**.

### Push to GitHub

```powershell
git add .
git commit -m "Deploy Live Workspace"
git push
```

### Deploy on Render

1. Sign up at [render.com](https://render.com)
2. Click **New +** → **Blueprint**
3. Connect your GitHub repo
4. Render reads `render.yaml` and deploys automatically
5. Copy your app URL, e.g. `https://live-workspace.onrender.com`

### Update extension config

In `config.js`:

```js
const SERVER_URL = "https://live-workspace.onrender.com";
```

Reload the extension at `chrome://extensions`.

### Share with teammate

Send them your Render URL:

```
https://live-workspace.onrender.com
```

They open it anywhere — no VPN or same Wi‑Fi needed.

> **Note:** Render's free tier sleeps after ~15 minutes of inactivity. The first visit after sleep may take 30–60 seconds to wake up.

## 4. Alternative: ngrok (quick remote test)

If you don't want to deploy yet:

1. Start the local server (`npm start` in `server/`)
2. Run `ngrok http 8765`
3. Share the `https://....ngrok-free.app` URL with your teammate
4. Keep `config.js` pointed at `http://localhost:8765` (extension posts locally; ngrok tunnels the viewer)

## How it works

| Component | Role |
|-----------|------|
| `content.js` | Watches the page for text changes |
| `background.js` | POSTs text to the relay server |
| `server.js` | Receives POST at `/answer`, broadcasts to viewers via WebSocket |
| `viewer.html` | Displays live text for teammates |

## Troubleshooting

### Extension not detecting text

- Open DevTools → Console and look for `[Live Workspace] ANSWER CHANGED`
- Reload the extension after any code changes

### Viewer shows "Connected" but no text

- Check `config.js` has the correct `SERVER_URL`
- Reload the extension
- Restart the server (local) or redeploy (Render)
- Ask a **new** question to trigger an update

### `npm` blocked on Windows (PowerShell)

Use the `.cmd` shim:

```powershell
npm.cmd install
npm.cmd start
```

Or fix execution policy:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### PowerShell `&&` not supported

Run commands separately:

```powershell
cd server
npm.cmd start
```

## License

Private / personal use.
