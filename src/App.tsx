import { useState } from 'react';
import PlayersPage from './components/PlayersPage';
import GamesPage from './components/GamesPage';
import StatsPage from './components/StatsPage';

type Tab = 'games' | 'players' | 'stats';

export default function App() {
  const [tab, setTab] = useState<Tab>('games');

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-bold tracking-tight">
            🃏 Ligretto Scorekeeper
          </h1>
          <nav className="flex gap-1">
            {(['games', 'players', 'stats'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${
                  tab === t
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {t}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {tab === 'games' && <GamesPage />}
        {tab === 'players' && <PlayersPage />}
        {tab === 'stats' && <StatsPage />}
      </main>
    </div>
  );
}
