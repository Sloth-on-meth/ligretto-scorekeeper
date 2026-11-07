import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { Player } from '../types';
import { PLAYER_COLORS, surface, border, muted } from '../theme';

interface Props {
  canEdit: boolean;
}

export default function PlayersPage({ canEdit }: Props) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.players.list()
      .then(setPlayers)
      .catch(err => setError((err as Error).message));
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (action: () => Promise<unknown>, onSuccess?: () => void) => {
    setError('');
    try {
      await action();
      onSuccess?.();
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    return run(() => api.players.create(name), () => setName(''));
  };

  const startRename = (player: Player) => {
    setEditingId(player.id);
    setEditName(player.name);
    setError('');
  };

  const saveRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId === null) return;
    const id = editingId;
    return run(() => api.players.rename(id, editName), () => setEditingId(null));
  };

  const remove = (player: Player) => {
    if (!window.confirm(`Remove ${player.name}? This cannot be undone.`)) return;
    return run(() => api.players.delete(player.id));
  };

  const inputStyle = {
    backgroundColor: surface,
    border: `1px solid ${border}`,
    color: '#fff',
  };

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-end justify-between gap-3 mb-6">
        <h2 className="text-2xl font-black uppercase tracking-wide">Players</h2>
        {players.length > 0 && (
          <p className="text-xs font-medium" style={{ color: muted }}>{players.length} total</p>
        )}
      </div>

      {canEdit ? (
        <form onSubmit={add} className="flex gap-2 mb-6">
          <input
            aria-label="New player name"
            className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none"
            style={inputStyle}
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
          You&apos;re in read-only mode. Sign in to add or edit players.
        </div>
      )}

      {error && <p className="text-sm mb-4" style={{ color: '#f87171' }} role="alert">{error}</p>}

      <ul className="space-y-2">
        {players.map((p, i) => {
          const c = PLAYER_COLORS[i % PLAYER_COLORS.length];
          const isEditing = editingId === p.id;
          return (
            <li key={p.id}
              className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
              style={{ backgroundColor: surface, border: `1px solid ${border}` }}
            >
              {isEditing ? (
                <form onSubmit={saveRename} className="flex flex-1 min-w-0 items-center gap-2">
                  <input
                    aria-label={`New name for ${p.name}`}
                    autoFocus
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Escape') { setEditingId(null); setError(''); } }}
                    className="flex-1 min-w-0 rounded-lg px-3 py-1.5 text-sm font-bold focus:outline-none"
                    style={inputStyle}
                    required
                  />
                  <button type="submit" className="flex-shrink-0 text-xs font-black uppercase tracking-wide px-3 py-1.5 rounded-lg"
                    style={{ backgroundColor: '#15502a', color: '#4ade80', border: '1px solid #1a6634' }}>
                    Save
                  </button>
                  <button type="button" onClick={() => { setEditingId(null); setError(''); }}
                    className="flex-shrink-0 text-xs font-medium" style={{ color: muted }}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Ligretto-style card chip */}
                    <div className="rounded-lg font-black text-sm flex items-center justify-center flex-shrink-0"
                      style={{ width: 32, height: 40, backgroundColor: c.bg, color: c.text, boxShadow: '0 2px 6px rgba(0,0,0,0.4)' }}
                      aria-hidden="true">
                      {i + 1}
                    </div>
                    <span className="font-bold truncate">{p.name}</span>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <button
                        onClick={() => startRename(p)}
                        aria-label={`Rename ${p.name}`}
                        className="text-sm font-medium transition-colors"
                        style={{ color: muted }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
                        onMouseLeave={e => (e.currentTarget.style.color = muted)}
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => remove(p)}
                        aria-label={`Remove ${p.name}`}
                        className="text-sm font-medium transition-colors"
                        style={{ color: muted }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                        onMouseLeave={e => (e.currentTarget.style.color = muted)}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
        {players.length === 0 && (
          <div className="text-center py-16" style={{ color: muted }}>
            <div className="flex justify-center gap-1 mb-4" aria-hidden="true">
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
