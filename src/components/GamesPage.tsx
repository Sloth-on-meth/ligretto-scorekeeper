import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Game, Player } from '../types';
import GameView from './GameView';
import { PLAYER_COLORS, surface, border, muted } from '../theme';

export default function GamesPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<number[]>([]);
  const [activeGameId, setActiveGameId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    api.games.list().then(setGames);
    api.players.list().then(setPlayers);
  };

  useEffect(() => { load(); }, []);

  if (activeGameId !== null) {
    return <GameView gameId={activeGameId} onBack={() => { setActiveGameId(null); load(); }} />;
  }

  const togglePlayer = (id: number) => {
    setSelectedPlayers(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const startGame = async () => {
    setError('');
    if (selectedPlayers.length < 2) return setError('Select at least 2 players');
    try {
      const game = await api.games.create(selectedPlayers);
      setSelectedPlayers([]);
      load();
      setActiveGameId(game.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const deleteGame = async (id: number) => {
    await api.games.delete(id);
    load();
  };

  return (
    <div>
      <h2 className="text-2xl font-black mb-6 uppercase tracking-wide">Games</h2>

      {/* New game panel */}
      <div className="rounded-2xl p-5 mb-8" style={{ backgroundColor: surface, border: `1px solid ${border}` }}>
        <p className="text-xs font-black uppercase tracking-widest mb-4" style={{ color: muted }}>New Game</p>

        {players.length < 2 ? (
          <p className="text-sm" style={{ color: muted }}>Add at least 2 players first.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-5">
              {players.map((p, i) => {
                const c = PLAYER_COLORS[i % PLAYER_COLORS.length];
                const sel = selectedPlayers.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePlayer(p.id)}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold transition-all"
                    style={sel
                      ? { backgroundColor: c.bg, color: c.text, boxShadow: `0 0 0 2px ${c.bg}40` }
                      : { backgroundColor: '#111118', color: muted, border: `1px solid ${border}` }
                    }
                  >
                    <span className="rounded font-black text-xs flex items-center justify-center"
                      style={{ width: 18, height: 22, backgroundColor: sel ? 'rgba(0,0,0,0.25)' : c.bg, color: '#fff', fontSize: '0.6rem' }}>
                      {i + 1}
                    </span>
                    {p.name}
                    {sel && <span className="text-xs opacity-70">✓</span>}
                  </button>
                );
              })}
            </div>
            {error && <p className="text-sm mb-3" style={{ color: '#f87171' }}>{error}</p>}
            <button
              onClick={startGame}
              disabled={selectedPlayers.length < 2}
              className="px-6 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-all disabled:opacity-30"
              style={{ backgroundColor: '#e02020', color: '#fff' }}
            >
              Start — {selectedPlayers.length} Players
            </button>
          </>
        )}
      </div>

      {/* Games list */}
      <div className="space-y-2">
        {games.map(g => (
          <div key={g.id}
            className="rounded-xl px-4 py-3 flex items-center justify-between"
            style={{ backgroundColor: surface, border: `1px solid ${border}` }}
          >
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-bold text-sm">Game #{g.id}</span>
                <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                  style={g.finished_at
                    ? { backgroundColor: '#0f2a18', color: '#4ade80' }
                    : { backgroundColor: '#2a1010', color: '#fca5a5' }
                  }>
                  {g.finished_at ? 'Finished' : 'Active'}
                </span>
              </div>
              <p className="text-xs" style={{ color: muted }}>
                {new Date(g.started_at).toLocaleString()} · {g.round_count} rounds · {g.player_names}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setActiveGameId(g.id)}
                className="text-sm font-black uppercase tracking-wide px-3 py-1.5 rounded-lg"
                style={{ backgroundColor: '#e02020', color: '#fff' }}
              >
                Open
              </button>
              <button
                onClick={() => deleteGame(g.id)}
                className="text-xs font-medium transition-colors"
                style={{ color: muted }}
                onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                onMouseLeave={e => (e.currentTarget.style.color = muted)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {games.length === 0 && (
          <div className="text-center py-16" style={{ color: muted }}>
            <div className="flex justify-center gap-1 mb-4">
              {['#c81818','#1844c8','#18a030','#c89800'].map((c, i) => (
                <div key={i} className="rounded-xl font-black text-2xl flex items-center justify-center"
                  style={{ width: 52, height: 70, backgroundColor: c, color: '#fff', opacity: 0.4, transform: `rotate(${(i-1.5)*8}deg)` }}>
                  {i + 1}
                </div>
              ))}
            </div>
            <p className="text-sm mt-6">No games yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
