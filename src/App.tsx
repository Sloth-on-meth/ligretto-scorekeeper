import { useState } from 'react';
import PlayersPage from './components/PlayersPage';
import GamesPage from './components/GamesPage';
import StatsPage from './components/StatsPage';
import { surface, border, muted } from './theme';

type Tab = 'games' | 'players' | 'stats';

export default function App() {
  const [tab, setTab] = useState<Tab>('games');

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#111118', color: '#fff' }}>
      <header style={{ backgroundColor: surface, borderBottom: `1px solid ${border}` }}
        className="sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-0 flex items-stretch justify-between">

          {/* Logo */}
          <div className="flex items-center gap-0 py-2">
            {/* Coloured card stack */}
            <div className="flex mr-3" style={{ gap: '-4px' }}>
              {['#c81818','#1844c8','#18a030','#c89800'].map((c, i) => (
                <div key={i} className="rounded-md flex items-center justify-center font-black text-white text-xs"
                  style={{ width: 22, height: 30, backgroundColor: c, marginLeft: i === 0 ? 0 : -8, zIndex: i, boxShadow: '1px 1px 3px rgba(0,0,0,0.5)', transform: `rotate(${(i-1.5)*6}deg)` }}>
                  {i + 1}
                </div>
              ))}
            </div>
            <div className="ml-2">
              <div className="font-black text-lg leading-none tracking-widest uppercase" style={{ color: '#e02020' }}>
                Ligretto
              </div>
              <div className="text-xs tracking-widest uppercase" style={{ color: muted, fontSize: '0.6rem' }}>
                Scorekeeper
              </div>
            </div>
          </div>

          {/* Nav tabs */}
          <nav className="flex items-stretch gap-0">
            {(['games', 'players', 'stats'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="px-4 text-sm font-bold capitalize transition-all relative"
                style={tab === t
                  ? { color: '#fff', borderBottom: '3px solid #e02020' }
                  : { color: muted, borderBottom: '3px solid transparent' }
                }
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
