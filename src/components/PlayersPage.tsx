import { useState, useEffect } from 'react';
import { api } from '../api';
import type { Player } from '../types';
import { PLAYER_COLORS, surface, border, muted } from '../theme';

interface Props {
  canEdit: boolean;
}

export default function PlayersPage({ canEdit }: Props) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const load = () => api.players.list().then(setPlayers);
  useEffect(() => { load(); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.players.create(name);
      setName('');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (id: number) => {
    await api.players.delete(id);
    load();
  };

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-2xl font-black mb-6 uppercase tracking-wide">Players</h2>

      {canEdit ? (
        <form onSubmit={add} className="flex gap-2 mb-6">
          <input
            className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none"
            style={{ backgroundColor: surface, border: `1px solid ${border}`, color: '#fff' }}
            placeholder="Enter player name…"
            value={name}
            onChange={e => setName(e.target.value)}
            required
          />
          <button
            type="submit"
            className="px-5 py-2.5 rounded-xl text-sm font-black uppercase tracking-wide"
            style={{ backgroundColor: '#e02020', color: '#fff' }}
          >
            Add
          </button>
        </form>
      ) : (
        <div className="rounded-xl px-4 py-3 mb-6 text-sm" style={{ backgroundColor: surface, border: `1px solid ${border}`, color: muted }}>
          You&apos;re in read-only mode. Sign in to add or remove players.
        </div>
      )}

      {error && <p className="text-sm mb-4" style={{ color: '#f87171' }}>{error}</p>}

      <ul className="space-y-2">
        {players.map((p, i) => {
          const c = PLAYER_COLORS[i % PLAYER_COLORS.length];
          return (
            <li key={p.id}
              className="flex items-center justify-between rounded-xl px-4 py-3"
              style={{ backgroundColor: surface, border: `1px solid ${border}` }}
            >
              <div className="flex items-center gap-3">
                {/* Ligretto-style card chip */}
                <div className="rounded-lg font-black text-sm flex items-center justify-center"
                  style={{ width: 32, height: 40, backgroundColor: c.bg, color: c.text, boxShadow: '0 2px 6px rgba(0,0,0,0.4)' }}>
                  {i + 1}
                </div>
                <span className="font-bold">{p.name}</span>
              </div>
              {canEdit && (
                <button
                  onClick={() => remove(p.id)}
                  className="text-sm font-medium transition-colors"
                  style={{ color: muted }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                  onMouseLeave={e => (e.currentTarget.style.color = muted)}
                >
                  Remove
                </button>
              )}
            </li>
          );
        })}
        {players.length === 0 && (
          <div className="text-center py-16" style={{ color: muted }}>
            <div className="flex justify-center gap-1 mb-4">
              {PLAYER_COLORS.map((c, i) => (
                <div key={i} className="rounded-lg font-black text-lg flex items-center justify-center"
                  style={{ width: 36, height: 48, backgroundColor: c.bg, color: '#fff', opacity: 0.5 }}>
                  {i + 1}
                </div>
              ))}
            </div>
            <p className="text-sm">No players yet. Add one above.</p>
          </div>
        )}
      </ul>
    </div>
  );
}
