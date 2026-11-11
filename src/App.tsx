import { useCallback, useEffect, useRef, useState } from 'react';
import LandingPage from './components/LandingPage';
import SignInPage from './components/SignInPage';
import NewGamePage from './components/NewGamePage';
import GamesListPage from './components/GamesListPage';
import PlayersPage from './components/PlayersPage';
import StatsPage from './components/StatsPage';
import GameView from './components/GameView';
import CardFan from './components/CardFan';
import { api, SESSION_EXPIRED_EVENT } from './api';
import { useFeedback } from './feedback';
import type { AuthSession } from './types';
import { HOME, backLabelFor, isView, viewForOrigin, viewFromPath, viewPath, type View } from './navigation';
import { muted } from './theme';

const SIGNED_OUT: AuthSession = { authenticated: false, role: null, group: null };

function Splash() {
  return (
    <div className="min-h-screen flex items-center justify-center" aria-busy="true" aria-label="Loading">
      <CardFan size={40} className="anim-float" />
    </div>
  );
}

export default function App() {
  const { toast } = useFeedback();
  const [auth, setAuth] = useState<AuthSession>(SIGNED_OUT);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState<View>(() => viewFromPath(window.location.pathname));
  // True when the current game screen was opened from inside the app, so Back can use real history.
  const openedGameFromApp = useRef(false);

  // Keep the URL and browser history in step with the screen, so refresh and Back behave.
  const navigate = useCallback((next: View, options: { replace?: boolean } = {}) => {
    setView(next);
    const path = viewPath(next);
    if (options.replace) window.history.replaceState(next, '', path);
    else window.history.pushState(next, '', path);
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const initial = viewFromPath(window.location.pathname);
    window.history.replaceState(initial, '', viewPath(initial));
    const onPop = (e: PopStateEvent) => {
      openedGameFromApp.current = false;
      setView(isView(e.state) ? e.state : viewFromPath(window.location.pathname));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // When a request says the sign-in has ended, show the sign-in screen and say why.
  useEffect(() => {
    const onExpired = () => {
      setAuth(SIGNED_OUT);
      toast('Your session has ended. Sign in again to continue.', 'error');
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [toast]);

  useEffect(() => {
    api.auth.session()
      .then(setAuth)
      .catch(() => setAuth(SIGNED_OUT))
      .finally(() => setAuthLoading(false));
  }, []);

  const canEdit = auth.role === 'admin';
  const canPlay = auth.authenticated;

  const logout = async () => {
    try {
      setAuth(await api.auth.logout());
      navigate(HOME, { replace: true });
      toast('Signed out');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const openGame = (id: number, from: 'new' | 'games') => {
    openedGameFromApp.current = true;
    navigate({ kind: 'game', id, from });
  };

  const leaveGame = (from: View & { kind: 'game' }) => {
    if (openedGameFromApp.current && window.history.length > 1) {
      // We pushed this game screen ourselves, so a real Back keeps history tidy.
      openedGameFromApp.current = false;
      window.history.back();
    } else {
      navigate(viewForOrigin(from.from), { replace: true });
    }
  };

  if (authLoading) return <Splash />;

  if (!auth.authenticated) {
    return <SignInPage onSignedIn={session => { setAuth(session); toast('Signed in', 'success'); }} />;
  }

  if (view.kind === 'home') {
    return <LandingPage auth={auth} onNavigate={navigate} onLogout={logout} />;
  }

  const pageKey = view.kind === 'game' ? `game-${view.id}` : view.kind;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10" style={{ backgroundColor: 'rgba(12,12,20,0.82)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)' }}>
        <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 py-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(HOME)}
            className="flex items-center gap-2 rounded-xl"
            aria-label="Home"
          >
            <CardFan size={18} />
            <span className="font-black text-sm tracking-[.2em] uppercase hidden sm:inline" style={{ color: 'var(--red-bright)' }}>
              Ligretto
            </span>
          </button>
          <nav aria-label="Account" className="ml-auto flex items-center gap-2">
            <span className="pill">{canEdit ? 'Admin' : auth.group?.name ?? 'Player'}</span>
            <button type="button" onClick={logout} className="btn-ghost text-xs">Log out</button>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 py-5 sm:py-8">
        {view.kind !== 'game' && (
          <button
            type="button"
            onClick={() => navigate(HOME)}
            className="text-sm font-bold mb-5 flex items-center gap-1 transition-colors"
            style={{ color: muted }}
            onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
            onMouseLeave={e => (e.currentTarget.style.color = muted)}
          >
            ← Home
          </button>
        )}

        <div key={pageKey} className="anim-fade-up">
          {view.kind === 'new' && <NewGamePage canEdit={canEdit} onOpenGame={id => openGame(id, 'new')} />}
          {view.kind === 'games' && <GamesListPage canEdit={canEdit} onOpenGame={id => openGame(id, 'games')} />}
          {view.kind === 'stats' && <StatsPage />}
          {view.kind === 'players' && <PlayersPage canEdit={canEdit} />}
          {view.kind === 'game' && (
            <GameView
              gameId={view.id}
              canEdit={canEdit}
              canPlay={canPlay}
              backLabel={backLabelFor(view.from)}
              onBack={() => leaveGame(view)}
            />
          )}
        </div>
      </main>
    </div>
  );
}
