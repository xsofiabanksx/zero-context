# Zero Context

A Discord Activity MVP built around one idea:

> **How much context do you need?**

Modes included:

- **Reveal** — progressively reveal clues or visual/emoji context.
- **Trivia** — fast multiple-choice questions.
- **Draw** — one player gets a word, draws it, and others guess.
- **Mixed** — rotates between all game types.

## 1. Install

Requirements:

- Node.js 20+
- npm

From the project root:

```bash
npm run install:all
```

Copy environment files:

```bash
cp client/.env.example client/.env
cp server/.env.example server/.env
```

## 2. Run locally

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

You can test Draw mode alone. For a quick two-browser realtime test, open:

```text
http://localhost:5173/?room=test
```

in two browser windows.

## 3. Connect to Discord

Create an application in the Discord Developer Portal, then enable Activities and configure a URL Mapping to the hosted client.

Set:

`client/.env`

```env
VITE_DISCORD_CLIENT_ID=YOUR_APPLICATION_ID
VITE_API_ORIGIN=https://YOUR_BACKEND_DOMAIN
```

`server/.env`

```env
DISCORD_CLIENT_ID=YOUR_APPLICATION_ID
DISCORD_CLIENT_SECRET=YOUR_CLIENT_SECRET
CLIENT_ORIGIN=https://YOUR_ACTIVITY_DOMAIN
PORT=3001
```

Never put the Discord client secret in the browser/client environment.

## 4. Current MVP behavior

This starter intentionally focuses on the playable game loop and UI.

Working now:

- mode selection
- eight-round sessions
- scoring
- trivia
- progressive clue reveal
- emoji reveal
- freehand drawing canvas
- brush size/color
- guess feed
- Socket.IO drawing/guess sync
- Discord OAuth scaffold
- responsive layout

Next production steps:

1. Make the host authoritative for rounds and timers.
2. Assign the drawer on the server and hide the secret word from guessers.
3. Use the Discord Activity instance/channel context as the room key.
4. Add player roster and presence.
5. Add real image/audio reveal content.
6. Store question packs in a database.
7. Add moderation/reporting for user-generated drawing content.
8. Add reconnection and late-join state sync.
9. Add lobby settings: category, round count, difficulty, timers.
10. Deploy client + server over HTTPS.

## Game design

### Scoring

Reveal / clue ladder:

- Context 1: 1000
- Context 2: 750
- Context 3: 500
- Context 4: 250

Drawing:

- MVP currently awards 1000 for a correct guess.
- Production version should reduce points by elapsed time.

### Brand language

- **Zero Context** — product name
- **How much context do you need?** — tagline
- **Know it?** — recurring prompt
- **Reveal** — request another clue
- **No Context** — potential achievement for first-clue answers
- **Full Context** — last clue

## Project structure

```text
zero-context/
├─ client/
│  ├─ src/
│  │  ├─ main.js
│  │  ├─ questions.js
│  │  └─ style.css
│  ├─ index.html
│  └─ package.json
├─ server/
│  ├─ index.js
│  └─ package.json
└─ README.md
```

## Security notes

- Keep `DISCORD_CLIENT_SECRET` server-side only.
- Validate server events before production.
- Do not trust client-submitted scores.
- Do not reveal Draw mode words to non-drawers in production.
