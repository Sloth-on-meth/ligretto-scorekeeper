import type { AuthSession, Game, GameDetail, Group, Player, PlayerStats } from './types';

const BASE = '/api';

/** Fired on window when a request is refused because the sign-in has ended. */
export const SESSION_EXPIRED_EVENT = 'ligretto:session-expired';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
  } catch {
    throw new ApiError('Can’t reach the server. Check your connection and try again.', 0);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    let message = body?.error;
    if (!message) {
      message = res.status >= 500
        ? 'The server hit a problem. Try again in a moment.'
        : 'Something went wrong. Try again.';
    }
    if (res.status >= 500) message = 'The server hit a problem. Try again in a moment.';
    // A 401 outside the sign-in endpoints means the session has ended.
    if (res.status === 401 && !url.startsWith('/auth/')) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError('The server sent an unexpected response.', res.status);
  }
}

export const api = {
  auth: {
    session: () => req<AuthSession>('/auth/session'),
    login: (password: string) => req<AuthSession>('/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
    logout: () => req<AuthSession>('/auth/logout', { method: 'POST' }),
  },
  groups: {
    list: () => req<Group[]>('/groups'),
  },
  players: {
    list: () => req<Player[]>('/players'),
    create: (name: string, group_id: number) =>
      req<Player>('/players', { method: 'POST', body: JSON.stringify({ name, group_id }) }),
    rename: (id: number, name: string) => req<Player>(`/players/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
    delete: (id: number) => req<void>(`/players/${id}`, { method: 'DELETE' }),
  },
  games: {
    list: () => req<Game[]>('/games'),
    trash: () => req<Game[]>('/games/trash'),
    create: (player_ids: number[]) => req<Game>('/games', { method: 'POST', body: JSON.stringify({ player_ids }) }),
    import: (player_names: string[], rounds: { scores: { player_name: string; score: number }[] }[], group_id: number) =>
      req<Game>('/games/import', { method: 'POST', body: JSON.stringify({ player_names, rounds, group_id }) }),
    get: (id: number) => req<GameDetail>(`/games/${id}`),
    finish: (id: number) => req<Game>(`/games/${id}/finish`, { method: 'PATCH' }),
    trashOne: (id: number) => req<Game>(`/games/${id}/trash`, { method: 'PATCH' }),
    restore: (id: number) => req<Game>(`/games/${id}/restore`, { method: 'PATCH' }),
    addPlayer: (id: number, player_id: number) =>
      req<Player[]>(`/games/${id}/players`, { method: 'POST', body: JSON.stringify({ player_id }) }),
    delete: (id: number) => req<void>(`/games/${id}`, { method: 'DELETE' }),
  },
  rounds: {
    add: (gameId: number, scores: { player_id: number; score?: number; cards_played?: number; cards_in_hand?: number }[]) =>
      req(`/games/${gameId}/rounds`, { method: 'POST', body: JSON.stringify({ scores }) }),
    update: (gameId: number, roundId: number, scores: { player_id: number; score?: number; cards_played?: number; cards_in_hand?: number }[]) =>
      req(`/games/${gameId}/rounds/${roundId}`, { method: 'PUT', body: JSON.stringify({ scores }) }),
    delete: (gameId: number, roundId: number) =>
      req<void>(`/games/${gameId}/rounds/${roundId}`, { method: 'DELETE' }),
  },
  stats: {
    list: () => req<PlayerStats[]>('/stats'),
  },
};
