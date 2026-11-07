import { useEffect, useState } from 'react';
import PlayersPage from './components/PlayersPage';
import GamesPage from './components/GamesPage';
import StatsPage from './components/StatsPage';
import { api } from './api';
import { useFeedback } from './feedback';
import type { AuthSession } from './types';
import { surface, border, muted } from './theme';

type Tab = 'games' | 'players' | 'stats';

export default function App() {
  const { toast } = useFeedback();
  const [tab, setTab] = useState<Tab>('games');
  // Bumping this remounts GamesPage, which resets it to the game list.
  const [gamesHomeSignal, setGamesHomeSignal] = useState(0);
  const [auth, setAuth] = useState<AuthSession>({ authenticated: false, role: null });
  const [authLoading, setAuthLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    api.auth.session()
      .then(setAuth)
      .finally(() => setAuthLoading(false));
  }, []);

  // Admins manage everything; players can start games and enter scores.
  const canEdit = auth.role === 'admin';
  const canPlay = auth.role === 'admin' || auth.role === 'player';

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const session = await api.auth.login(password);
      setAuth(session);
      setPassword('');
      toast('Signed in', 'success');
    } catch (err) {
      setAuthError((err as Error).message);
    }
  };

  const logout = async () => {
    try {
      setAuth(await api.auth.logout());
      setAuthError('');
      toast('Signed out');
    } catch (err) {
      setAuthError((err as Error).message);
    }
  };

  const goHome = () => {
    setTab('games');
    setGamesHomeSignal(prev => prev + 1);
  };

  // Tapping the active tab returns it to its start view (e.g. back out of a game).
  const selectTab = (next: Tab) => {
    if (next === tab && next === 'games') goHome();
    else setTab(next);
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#111118', color: '#fff' }}>
      <header style={{ backgroundColor: surface, borderBottom: `1px solid ${border}` }}
        className="sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 py-2 flex flex-wrap items-center gap-x-4 gap-y-2">

          {/* Logo */}
          <button
            type="button"
            onClick={goHome}
            className="flex items-center gap-0 rounded-xl transition-opacity cursor-pointer order-1"
            style={{ backgroundColor: 'transparent' }}
            title="Back to games"
          >
            <div className="flex mr-3" style={{ gap: '-4px' }}>
              {['#c81818','#1844c8','#18a030','#c89800'].map((c, i) => (
                <div key={i} className="rounded-md flex items-center justify-center font-black text-white text-xs"
                  style={{ width: 22, height: 30, backgroundColor: c, marginLeft: i === 0 ? 0 : -8, zIndex: i, boxShadow: '1px 1px 3px rgba(0,0,0,0.5)', transform: `rotate(${(i-1.5)*6}deg)` }}>
                  {i + 1}
                </div>
              ))}
            </div>
            <div className="ml-2 text-left">
              <div className="font-black text-lg leading-none tracking-widest uppercase" style={{ color: '#e02020' }}>
                Ligretto
              </div>
              <div className="text-xs tracking-widest uppercase" style={{ color: muted, fontSize: '0.6rem' }}>
                Scorekeeper
              </div>
            </div>
          </button>

          {/* Sign-in / role (phones: sits beside the logo) */}
          <div className="order-2 ml-auto flex items-center gap-2 md:order-3">
            {authLoading ? (
              <span className="text-xs font-bold uppercase tracking-wide" style={{ color: muted }}>
                Checking auth…
              </span>
            ) : canPlay ? (
              <div className="flex items-center gap-2 ">
                <span className="text-xs font-black uppercase tracking-wide px-2 py-1 rounded-lg"
                  style={{ backgroundColor: '#15502a', color: '#4ade80' }}>
                  {auth.role === 'admin' ? 'Admin' : 'Player'}
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
              <form onSubmit={login} className="flex w-full items-center gap-2 md:w-auto">
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={e => {
                    setPassword(e.target.value);
                    if (authError) setAuthError('');
                  }}
                  placeholder="Password"
                  aria-label="Password"
                  className="rounded-xl px-3 py-2 text-sm focus:outline-none flex-1 md:w-44"
                  style={{ backgroundColor: '#111118', border: `1px solid ${border}`, color: '#fff' }}
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wide whitespace-nowrap"
                  style={{ backgroundColor: '#e02020', color: '#fff' }}
                >
                  Sign in
                </button>
              </form>
            )}
          </div>

          {/* Nav tabs (phones: full-width second row) */}
          <div className="order-3 w-full md:order-2 md:w-auto">
            <nav aria-label="Main" className="flex items-stretch gap-0 overflow-x-auto scrollbar-none">
              {(['games', 'players', 'stats'] as Tab[]).map(t => (
                <button
                  type="button"
                  key={t}
                  aria-current={tab === t ? 'page' : undefined}
                  onClick={() => selectTab(t)}
                  className="px-4 py-2 text-sm font-bold capitalize transition-all relative whitespace-nowrap"
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
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 md:py-8">
        {!authLoading && !canPlay && (
          <div className="rounded-xl px-4 py-3 mb-6 text-sm" style={{ backgroundColor: surface, border: `1px solid ${border}` }}>
            <span style={{ color: '#fff' }}>Read-only mode.</span>{' '}
            <span style={{ color: muted }}>Sign in to start games and enter scores.</span>
            {authError && <span style={{ color: '#f87171' }}> {authError}</span>}
          </div>
        )}

        {tab === 'games' && <GamesPage key={gamesHomeSignal} canEdit={canEdit} canPlay={canPlay} />}
        {tab === 'players' && <PlayersPage canEdit={canEdit} />}
        {tab === 'stats' && <StatsPage />}
      </main>
    </div>
  );
}
