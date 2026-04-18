# Hycrean Tarot 1.0

This workspace now contains the full local project files for the Hycrean Tarot 1.0 prototype, including:

- `Hycrean Tarot 1.0.html` – primary client/game HTML.
- `server.js` – Node + Socket.IO multiplayer server.
- `package.json` / `package-lock.json` – dependency and runtime metadata.

## Quick start

### 1) Install dependencies

```bash
npm install
```

### 2) Start server

```bash
npm start
```

### 3) Open client

Open `Hycrean Tarot 1.0.html` in a browser (or serve it from a local static host) and connect to the running server.

## Requirements

- Node.js 18+

## Notes

- `node_modules/` is intentionally git-ignored and should be regenerated locally with `npm install`.
