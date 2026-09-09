# Konsmon

Free, open-source chat — website at the repo root, desktop client under `client/`, shared voice/chat logic under `shared/`.

## Layout

- **Website (GitHub Pages):** `index.html`, `style.css`, `main.js`, `StreamManager.js`, …
- **Shared:** `shared/` — VoiceManager (RNNoise), ChatManager, Auth, etc.
- **Desktop client:** `client/` — Electron shell, tray, screen share + WASAPI, auto-update

## Website

Serve the repo root (or push `main` for Pages). Local config: copy `shared/config.example.js` → `config.js`.

## Desktop client

```bash
npm install
npm start
```

Build installer: `npm run dist` / `npm run release` (from repo root).
