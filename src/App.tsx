import { useEffect, useState } from 'react';
import PlayersPage from './components/PlayersPage';
import GamesPage from './components/GamesPage';
import StatsPage from './components/StatsPage';
import { api } from './api';
import type { AuthSession } from './types';
import { surface, border, muted } from './theme';

type Tab = 'games' | 'players' | 'stats';

export default function App() {
  const [tab, setTab] = useState<Tab>('games');
  const [auth, setAuth] = useState<AuthSession>({ authenticated: false, role: null });
  const [authLoading, setAuthLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    api.auth.session()
      .then(setAuth)
      .finally(() => setAuthLoading(false));
  }, []);

  const canEdit = auth.role === 'admin';

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const session = await api.auth.login(password);
      setAuth(session);
      setPassword('');
    } catch (err) {
      setAuthError((err as Error).message);
    }
  };

  const logout = async () => {
    const session = await api.auth.logout();
    setAuth(session);
    setAuthError('');
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#111118', color: '#fff' }}>
      <header style={{ backgroundColor: surface, borderBottom: `1px solid ${border}` }}
        className="sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-0 flex items-stretch justify-between gap-4">

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
          <div className="flex items-center gap-4">
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
            {authLoading ? (
              <span className="text-xs font-bold uppercase tracking-wide" style={{ color: muted }}>
                Checking auth…
              </span>
            ) : canEdit ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-black uppercase tracking-wide px-2 py-1 rounded-lg"
                  style={{ backgroundColor: '#15502a', color: '#4ade80' }}>
                  Admin
                </span>
                <button
                  onClick={logout}
                  className="px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wide"
                  style={{ backgroundColor: '#111118', border: `1px solid ${border}`, color: '#fff' }}
                >
                  Log out
                </button>
              </div>
            ) : (
              <form onSubmit={login} className="flex items-center gap-2">
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Admin password"
                  className="rounded-xl px-3 py-2 text-sm focus:outline-none w-36"
                  style={{ backgroundColor: '#111118', border: `1px solid ${border}`, color: '#fff' }}
                />
                <button
                  type="submit"
                  className="px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wide"
                  style={{ backgroundColor: '#e02020', color: '#fff' }}
                >
                  Sign in
                </button>
              </form>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {!authLoading && !canEdit && (
          <div className="rounded-xl px-4 py-3 mb-6 text-sm" style={{ backgroundColor: surface, border: `1px solid ${border}` }}>
            <span style={{ color: '#fff' }}>Read-only mode.</span>{' '}
            <span style={{ color: muted }}>Sign in to create games, manage players, import scores, or change data.</span>
            {authError && <span style={{ color: '#f87171' }}> {authError}</span>}
          </div>
        )}

        {tab === 'games' && <GamesPage canEdit={canEdit} />}
        {tab === 'players' && <PlayersPage canEdit={canEdit} />}
        {tab === 'stats' && <StatsPage />}
      </main>
    </div>
  );
}
