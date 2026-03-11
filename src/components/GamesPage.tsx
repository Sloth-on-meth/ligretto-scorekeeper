import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Game, Player } from '../types';
import GameView from './GameView';

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
      <h2 className="text-2xl font-bold mb-6">Games</h2>

      {/* New game */}
      <div className="bg-slate-800 rounded-xl p-4 mb-8">
        <h3 className="font-semibold mb-3">New Game</h3>
        {players.length < 2 ? (
          <p className="text-slate-400 text-sm">Add at least 2 players first.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              {players.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => togglePlayer(p.id)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    selectedPlayers.includes(p.id)
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            <button
              onClick={startGame}
              disabled={selectedPlayers.length < 2}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              Start Game ({selectedPlayers.length} players)
            </button>
          </>
        )}
      </div>

      {/* Game list */}
      <div className="space-y-3">
        {games.map(g => (
          <div key={g.id} className="bg-slate-800 rounded-xl px-4 py-3 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">Game #{g.id}</span>
                {g.finished_at
                  ? <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded-full">Finished</span>
                  : <span className="text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded-full">Active</span>
                }
              </div>
              <p className="text-slate-400 text-xs mt-0.5">
                {new Date(g.started_at).toLocaleString()} · {g.round_count} rounds · {g.player_names}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setActiveGameId(g.id)}
                className="text-blue-400 hover:text-blue-300 text-sm"
              >
                Open
              </button>
              <button
                onClick={() => deleteGame(g.id)}
                className="text-slate-500 hover:text-red-400 text-sm"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {games.length === 0 && (
          <p className="text-slate-400 text-sm text-center py-8">No games yet.</p>
        )}
      </div>
    </div>
  );
}
