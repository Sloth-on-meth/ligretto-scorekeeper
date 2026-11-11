<div align="center">

# 🃏 ligretto-scorekeeper

**self-hosted scorekeeper for the world's most chaotic card game**

[![made with](https://img.shields.io/badge/made_with-react_19-61dafb?style=flat-square&logo=react)](https://react.dev)
[![typescript](https://img.shields.io/badge/typescript-5.9-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![sqlite](https://img.shields.io/badge/storage-sqlite-003b57?style=flat-square&logo=sqlite)](https://www.sqlite.org)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](#license)


</div>

---

## what is this

a dead-simple webapp you run locally to track [Ligretto](https://en.wikipedia.org/wiki/Ligretto) scores across multiple games and players. everything persists to a single `.db` file on your machine. bring your laptop to game night, open a tab, and go.

## features

```
🎮  multi-game sessions     start, track, finish, repeat
📊  live scoreboard         sorted by total, per-round breakdown
🏆  winner tracking         crowns the winner on finish (ties share the trophy)
⚡  two input modes         formula (played − hand×2) or direct score entry
📈  player stats            lifetime totals, wins and ties, sortable table
📤  csv export              download any game as a spreadsheet
📥  tabular import          paste scores separated by tabs, commas or semicolons
🔐  read-only by default    sign in to make changes
📱  mobile-friendly         big tap targets, numeric keyboard on phones
🗑️  full edit control       edit or delete rounds, rename players, trash and restore games
💾  local sqlite            one file, zero dependencies on the internet
```

**scoring formula**
```
score = cards_played_to_middle − (cards_in_ligretto_stack × 2)
```

---

## stack

| | |
|---|---|
| **frontend** | React 19 + TypeScript + Vite + Tailwind CSS v4 |
| **backend** | Express 5, running via `tsx` |
| **database** | SQLite — `better-sqlite3` |
| **dev** | `concurrently` — one command starts everything |

---

## self-hosting

### requirements

- Node.js v18+

### install

```bash
git clone https://github.com/Sloth-on-meth/ligretto-scorekeeper
cd ligretto-scorekeeper
npm install
```

### run

```bash
npm run dev
```

open **http://localhost:5173** — that's it.

the API runs on `:3001`, proxied by Vite. the database is created at `data/ligretto.db` on first run (git-ignored, yours forever).

### configure passwords

secrets live in a `.env` file, which is git-ignored. create it from the example and fill in real values before first run:

```bash
cp .env.example .env
```

| variable | required | who it is for |
|---|---|---|
| `AUTH_PASSWORD` | yes | **admin**: everything, including editing or deleting rounds, finishing and trashing games, managing players, and importing |
| `PLAYER_PASSWORD` | no | **player**: start games and enter round scores. Leave empty to turn off player sign-in |
| `SESSION_SECRET` | yes | signs session cookies. use a long random string, e.g. `openssl rand -hex 32` |
| `COOKIE_SECURE` | no | set to `true` when served over https |

the app checks its configuration on startup and lists every problem it finds. it refuses to start if `AUTH_PASSWORD` or `SESSION_SECRET` is missing, too short, or still set to the example value. `AUTH_PASSWORD` needs at least 8 characters, `SESSION_SECRET` at least 16, and the player password must differ from the admin one.

logged-out visitors can browse everything in read-only mode. signing in with the player password lets you start games and enter scores. the admin password unlocks everything else.

### docker

create your local compose file first:

```bash
cp docker-compose.yml.example docker-compose.yml
```

```bash
docker compose up -d --build
```

open **http://localhost:3001**.

the app runs as a single container that serves both the frontend and API. sqlite data is stored in `./data/ligretto.db` on the host machine.

the compose file reads `.env` automatically, so set your passwords there before running `docker compose up -d --build`. the `.env` file is excluded from the docker image.

sign-in attempts are limited to 10 per 15 minutes per client address.

to update after pulling new repo changes:

```bash
git pull
docker compose up -d --build
```

if you later publish this image to a registry, `docker compose pull && docker compose up -d` will work too. for a local source checkout, `--build` is the important part because `docker compose pull` does not rebuild from updated files.

### configuration

| variable | default | purpose |
|---|---|---|
| `AUTH_PASSWORD` | *(required)* | admin sign-in password |
| `PLAYER_PASSWORD` | unset (player sign-in disabled) | player sign-in password: start games and enter scores |
| `SESSION_SECRET` | *(required)* | signs session cookies |
| `COOKIE_SECURE` | unset | set to `true` to mark the session cookie `Secure` (https only) |
| `TRUST_PROXY` | unset | set to `true` when behind a reverse proxy, so rate limits apply per real client, not per proxy |
| `DB_PATH` | `data/ligretto.db` | sqlite file location |
| `PORT` | `3001` | api / production server port |

### scripts

```bash
npm run dev        # frontend + backend, watch mode
npm run build      # type-check + production build
npm run typecheck  # type-check frontend and server without emitting
npm run lint       # eslint
npm test           # API tests (real app, temp database), validation, score input and import parsing
npm run server     # backend only
npm run preview    # preview the production build
```

---

## structure

```
ligretto-scorekeeper/
│
├── server/
│   ├── db.ts          # schema, migrations + sqlite connection
│   ├── logic.ts       # validation, scoring and winner rules (pure, tested)
│   ├── logic.test.ts  # unit tests for logic.ts
│   └── index.ts       # express api
│
├── src/
│   ├── components/
│   │   ├── GameView.tsx    # scoreboard + round entry
│   │   ├── GamesPage.tsx   # game list + new game
│   │   ├── PlayersPage.tsx # player management
│   │   └── StatsPage.tsx   # lifetime stats
│   ├── api.ts         # typed fetch wrapper
│   ├── theme.ts       # color palette
│   ├── types.ts       # shared ts types
│   └── App.tsx        # root + nav
│
├── data/
│   └── ligretto.db    # ← your data lives here (auto-created)
└── vite.config.ts
```

## schema

```sql
players      (id, name, created_at)                       -- names are unique, case-insensitive
games        (id, started_at, finished_at, deleted_at)    -- deleted_at set = in the trash
game_players (game_id, player_id)
rounds       (id, game_id, round_number, created_at)      -- unique per game
round_scores (id, round_id, player_id, cards_played, cards_in_hand, score)
```

round rules enforced by the api: every player in the game scores exactly once per round, card counts are whole numbers (played 0–40, in hand 0–10), and finished games are locked.

---

## license

MIT — do whatever you want with it.
