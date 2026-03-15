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
🏆  winner tracking         automatically crowns the winner on finish
⚡  two input modes         formula (played − hand×2) or direct score entry
📈  player stats            lifetime totals, avg per round, best/worst
📤  csv export              download any game as a spreadsheet
📥  tabular import          paste TSV scores to import a finished game
🔐  read-only by default    sign in to make changes
📱  mobile-friendly         big tap targets, numeric keyboard on phones
🗑️  full edit control       delete rounds or entire games at any time
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

by default, logged-out users can browse everything in read-only mode. to make changes, sign in with the admin password. unless you override it, the default password is:

```text
ligretto-admin
```

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

you can override the admin password and session secret with environment variables:

```bash
AUTH_PASSWORD=your-password
SESSION_SECRET=your-random-secret
docker compose up -d --build
```

to update after pulling new repo changes:

```bash
git pull
docker compose up -d --build
```

if you later publish this image to a registry, `docker compose pull && docker compose up -d` will work too. for a local source checkout, `--build` is the important part because `docker compose pull` does not rebuild from updated files.

### scripts

```bash
npm run dev      # frontend + backend, watch mode
npm run build    # production build
npm run server   # backend only
npm run preview  # preview the production build
```

---

## structure

```
ligretto-scorekeeper/
│
├── server/
│   ├── db.ts          # schema + sqlite connection
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
players      (id, name, created_at)
games        (id, started_at, finished_at)
game_players (game_id, player_id)
rounds       (id, game_id, round_number, created_at)
round_scores (id, round_id, player_id, cards_played, cards_in_hand, score)
```

---

## license

MIT — do whatever you want with it.
