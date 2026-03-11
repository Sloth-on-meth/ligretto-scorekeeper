# 🃏 Ligretto Scorekeeper

A fast, local scorekeeper webapp for **Ligretto** — the frantic real-time card game. Track rounds, see live standings, and review stats across all your games.

---

## Features

- **Multi-game tracking** — start a new game, add rounds, finish it, start another
- **Two input modes** — enter *cards played + cards in hand* (auto-calculates score) or type the score directly when you've got a big group
- **Live scoreboard** — sorted by total, color-coded per round, with per-round tooltips showing raw counts
- **Player statistics** — lifetime totals, averages, best and worst rounds across all games
- **Persistent storage** — everything lives in a local SQLite file (`ligretto.db`)
- **Delete & correct** — remove a bad round or an entire game without hassle

### Scoring formula

> **Score = Cards played to the middle − (Cards remaining in Ligretto stack × 2)**

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS v4 |
| Backend | Express 5 + tsx |
| Database | SQLite via `better-sqlite3` |

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+

### Install & run

```bash
git clone https://github.com/your-username/ligretto-scorekeeper.git
cd ligretto-scorekeeper
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

The backend API runs on port **3001** and is proxied automatically by Vite. The database file `ligretto.db` is created automatically in the project root on first run.

### Available scripts

| Command | Description |
|---|---|
| `npm run dev` | Run frontend + backend concurrently (development) |
| `npm run build` | Build frontend for production |
| `npm run preview` | Preview production build |
| `npm run server` | Run backend only |

---

## Project structure

```
ligretto-scorekeeper/
├── server/
│   ├── db.ts          # SQLite schema & connection
│   └── index.ts       # Express API routes
├── src/
│   ├── components/
│   │   ├── GameView.tsx    # Scoreboard + round entry
│   │   ├── GamesPage.tsx   # Game list + new game
│   │   ├── PlayersPage.tsx # Player management
│   │   └── StatsPage.tsx   # Lifetime statistics
│   ├── api.ts         # Typed fetch client
│   ├── types.ts       # Shared TypeScript types
│   └── App.tsx        # Root + navigation
├── ligretto.db        # SQLite database (auto-created, git-ignored)
└── vite.config.ts
```

---

## Database schema

```sql
players      (id, name, created_at)
games        (id, started_at, finished_at)
game_players (game_id, player_id)
rounds       (id, game_id, round_number, created_at)
round_scores (id, round_id, player_id, cards_played, cards_in_hand, score)
```

---

## License

MIT
