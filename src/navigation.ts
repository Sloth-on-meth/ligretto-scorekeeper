// Screens the app can show, and how they map to URLs so refresh and Back work.

export type GameOrigin = 'home' | 'new' | 'games';

export type View =
  | { kind: 'home' }
  | { kind: 'new' }
  | { kind: 'games' }
  | { kind: 'stats' }
  | { kind: 'players' }
  | { kind: 'game'; id: number; from: GameOrigin };

export const HOME: View = { kind: 'home' };

const ORIGINS: GameOrigin[] = ['home', 'new', 'games'];

/** Validates a value restored from browser history before trusting it. */
export function isView(value: unknown): value is View {
  if (!value || typeof value !== 'object') return false;
  const v = value as { kind?: unknown; id?: unknown; from?: unknown };
  switch (v.kind) {
    case 'home':
    case 'new':
    case 'games':
    case 'stats':
    case 'players':
      return true;
    case 'game':
      return Number.isInteger(v.id) && (v.id as number) > 0 && ORIGINS.includes(v.from as GameOrigin);
    default:
      return false;
  }
}

export function viewPath(view: View): string {
  switch (view.kind) {
    case 'home': return '/';
    case 'new': return '/new';
    case 'games': return '/games';
    case 'stats': return '/stats';
    case 'players': return '/players';
    case 'game': return `/games/${view.id}`;
  }
}

export function viewFromPath(path: string): View {
  const clean = path.replace(/\/+$/, '') || '/';
  if (clean === '/') return HOME;
  if (clean === '/new') return { kind: 'new' };
  if (clean === '/games') return { kind: 'games' };
  if (clean === '/stats') return { kind: 'stats' };
  if (clean === '/players') return { kind: 'players' };
  const game = /^\/games\/(\d+)$/.exec(clean);
  if (game) return { kind: 'game', id: Number(game[1]), from: 'games' };
  return HOME;
}

export function viewForOrigin(from: GameOrigin): View {
  switch (from) {
    case 'home': return HOME;
    case 'new': return { kind: 'new' };
    case 'games': return { kind: 'games' };
  }
}

export function backLabelFor(from: GameOrigin): string {
  switch (from) {
    case 'home': return '← Home';
    case 'new': return '← New game';
    case 'games': return '← Previous games';
  }
}
