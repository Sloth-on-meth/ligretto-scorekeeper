import { useState } from 'react';
import PlayersPage from './components/PlayersPage';
import GamesPage from './components/GamesPage';
import StatsPage from './components/StatsPage';

type Tab = 'games' | 'players' | 'stats';

const TAB_ICONS: Record<Tab, string> = {
  games: '♠',
  players: '♥',
  stats: '♦',
};

export default function App() {
  const [tab, setTab] = useState<Tab>('games');

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0a2218', color: '#f8f4ec' }}>
      <header style={{ borderBottom: '1px solid #1f5038', backgroundColor: 'rgba(10,34,24,0.92)', backdropFilter: 'blur(8px)' }}
        className="sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🃏</span>
            <div>
              <h1 className="text-base font-black tracking-widest uppercase" style={{ color: '#dc2626', letterSpacing: '0.15em' }}>
                Ligretto
              </h1>
              <p className="text-xs tracking-widest uppercase" style={{ color: '#6b9e7e', letterSpacing: '0.2em', marginTop: '-2px' }}>
                Scorekeeper
              </p>
            </div>
          </div>
          <nav className="flex gap-1">
            {(['games', 'players', 'stats'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold capitalize transition-all"
                style={tab === t
                  ? { backgroundColor: '#dc2626', color: '#f8f4ec' }
                  : { color: '#6b9e7e', backgroundColor: 'transparent' }
                }
              >
                <span className="mr-1 text-xs">{TAB_ICONS[t]}</span>
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

      <footer className="max-w-3xl mx-auto px-4 pb-6 text-center text-xs" style={{ color: '#2d6647' }}>
        ♠ ♥ ♦ ♣
      </footer>
    </div>
  );
}
