import type { Game, GameDetail, Player, PlayerStats } from './types';

const BASE = '/api';

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Request failed');
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  players: {
    list: () => req<Player[]>('/players'),
    create: (name: string) => req<Player>('/players', { method: 'POST', body: JSON.stringify({ name }) }),
    delete: (id: number) => req<void>(`/players/${id}`, { method: 'DELETE' }),
  },
  games: {
    list: () => req<Game[]>('/games'),
    create: (player_ids: number[]) => req<Game>('/games', { method: 'POST', body: JSON.stringify({ player_ids }) }),
    get: (id: number) => req<GameDetail>(`/games/${id}`),
    finish: (id: number) => req<Game>(`/games/${id}/finish`, { method: 'PATCH' }),
    delete: (id: number) => req<void>(`/games/${id}`, { method: 'DELETE' }),
  },
  rounds: {
    add: (gameId: number, scores: { player_id: number; cards_played: number; cards_in_hand: number }[]) =>
      req(`/games/${gameId}/rounds`, { method: 'POST', body: JSON.stringify({ scores }) }),
    delete: (gameId: number, roundId: number) =>
      req<void>(`/games/${gameId}/rounds/${roundId}`, { method: 'DELETE' }),
  },
  stats: {
    list: () => req<PlayerStats[]>('/stats'),
  },
};
