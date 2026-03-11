import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Game, Player } from '../types';
import GameView from './GameView';

const card = { backgroundColor: '#0f2e20', border: '1px solid #1f5038', borderRadius: '12px' };
const mutedText = { color: '#6b9e7e' };
const redBtn = { backgroundColor: '#dc2626', color: '#f8f4ec' };
const ghostBtn = { color: '#6b9e7e', backgroundColor: 'transparent' };

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
      <h2 className="text-2xl font-black tracking-wide mb-6" style={{ color: '#f8f4ec' }}>
        ♠ Games
      </h2>

      {/* New game */}
      <div style={card} className="p-5 mb-8">
        <h3 className="font-bold text-sm tracking-widest uppercase mb-4" style={{ color: '#f59e0b' }}>
          New Game
        </h3>
        {players.length < 2 ? (
          <p className="text-sm" style={mutedText}>Add at least 2 players first.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              {players.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => togglePlayer(p.id)}
                  className="px-3 py-1.5 rounded-full text-sm font-semibold transition-all"
                  style={selectedPlayers.includes(p.id)
                    ? redBtn
                    : { backgroundColor: '#163d2a', color: '#a7c4b5', border: '1px solid #1f5038' }
                  }
                >
                  {selectedPlayers.includes(p.id) ? '✓ ' : ''}{p.name}
                </button>
              ))}
            </div>
            {error && <p className="text-sm mb-3" style={{ color: '#f87171' }}>{error}</p>}
            <button
              onClick={startGame}
              disabled={selectedPlayers.length < 2}
              className="px-5 py-2 rounded-lg text-sm font-bold tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={selectedPlayers.length >= 2 ? redBtn : { backgroundColor: '#1f5038', color: '#6b9e7e' }}
            >
              Deal Cards — {selectedPlayers.length} Players
            </button>
          </>
        )}
      </div>

      {/* Game list */}
      <div className="space-y-3">
        {games.map(g => (
          <div key={g.id} style={card} className="px-4 py-3 flex items-center justify-between hover:brightness-110 transition-all">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-bold">Game #{g.id}</span>
                {g.finished_at
                  ? <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#14532d', color: '#86efac' }}>Finished</span>
                  : <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#7c1d1d', color: '#fca5a5' }}>Active</span>
                }
              </div>
              <p className="text-xs" style={mutedText}>
                {new Date(g.started_at).toLocaleString()} · {g.round_count} rounds · {g.player_names}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setActiveGameId(g.id)}
                className="text-sm font-semibold"
                style={{ color: '#f59e0b' }}
              >
                Open →
              </button>
              <button
                onClick={() => deleteGame(g.id)}
                className="text-sm"
                style={ghostBtn}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {games.length === 0 && (
          <div className="text-center py-12" style={mutedText}>
            <div className="text-4xl mb-3">🃏</div>
            <p className="text-sm">No games yet. Deal the cards!</p>
          </div>
        )}
      </div>
    </div>
  );
}
