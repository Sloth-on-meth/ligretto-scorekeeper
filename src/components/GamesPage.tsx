import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Game, Player } from '../types';
import GameView from './GameView';
import { PLAYER_COLORS, surface, border, muted } from '../theme';

interface ParsedImportGame {
  playerNames: string[];
  rounds: { scores: { player_name: string; score: number }[] }[];
}

interface Props {
  canEdit: boolean;
  homeSignal?: number;
}

function parseImportedGame(text: string): ParsedImportGame {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error('Paste a header row and at least one round');
  }

  const playerNames = lines[0]
    .split('\t')
    .map(name => name.trim())
    .filter(Boolean);

  if (playerNames.length < 2) {
    throw new Error('Header row must contain at least 2 player names');
  }

  const expectedColumns = playerNames.length;
  const rounds = lines.slice(1).map((line, index) => {
    const cells = line.split('\t').map(cell => cell.trim());
    if (cells.length !== expectedColumns) {
      throw new Error(`Round ${index + 1} has ${cells.length} columns; expected ${expectedColumns}`);
    }

    return {
      scores: cells.map((cell, cellIndex) => {
        if (!/^-?\d+$/.test(cell)) {
          throw new Error(`Round ${index + 1}, ${playerNames[cellIndex]} must be a whole number`);
        }

        return {
          player_name: playerNames[cellIndex],
          score: Number(cell),
        };
      }),
    };
  });

  return { playerNames, rounds };
}

export default function GamesPage({ canEdit, homeSignal = 0 }: Props) {
  const [games, setGames] = useState<Game[]>([]);
  const [trashedGames, setTrashedGames] = useState<Game[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<number[]>([]);
  const [activeGameId, setActiveGameId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [showTrash, setShowTrash] = useState(false);

  const load = () => {
    api.games.list().then(setGames);
    api.games.trash().then(setTrashedGames);
    api.players.list().then(setPlayers);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    setActiveGameId(null);
    setShowTrash(false);
    setError('');
    setImportError('');
  }, [homeSignal]);

  if (activeGameId !== null) {
    return <GameView gameId={activeGameId} canEdit={canEdit} onBack={() => { setActiveGameId(null); load(); }} />;
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

  const trashGame = async (id: number) => {
    const confirmed = window.confirm(
      'ARE YOU ABSOLUTELY SURE YOU WANT TO MOVE THIS GAME TO THE TRASH?\n\nYou can still restore it later.'
    );
    if (!confirmed) return;

    await api.games.trashOne(id);
    load();
  };

  const restoreGame = async (id: number) => {
    await api.games.restore(id);
    load();
  };

  const permanentlyDeleteGame = async (id: number) => {
    const confirmed = window.confirm(
      'ARE YOU ABSOLUTELY SURE YOU WANT TO PERMANENTLY DELETE?\n\nThis will permanently erase the game, all of its rounds, and all of its scores. This cannot be undone.'
    );
    if (!confirmed) return;

    await api.games.delete(id);
    load();
  };

  const importGame = async () => {
    setImportError('');

    try {
      const parsed = parseImportedGame(importText);
      const game = await api.games.import(parsed.playerNames, parsed.rounds);
      setImportText('');
      load();
      setActiveGameId(game.id);
    } catch (err) {
      setImportError((err as Error).message);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-black mb-6 uppercase tracking-wide">Games</h2>

      {/* New game panel */}
      <div className="rounded-2xl p-5 mb-8" style={{ backgroundColor: surface, border: `1px solid ${border}` }}>
        <p className="text-xs font-black uppercase tracking-widest mb-4" style={{ color: muted }}>New Game</p>

        {!canEdit ? (
          <p className="text-sm" style={{ color: muted }}>You&apos;re in read-only mode. Sign in to start a game.</p>
        ) : players.length < 2 ? (
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

      {canEdit && (
        <div className="rounded-2xl p-5 mb-8" style={{ backgroundColor: surface, border: `1px solid ${border}` }}>
          <p className="text-xs font-black uppercase tracking-widest mb-4" style={{ color: muted }}>Import Finished Game</p>
          <p className="text-sm mb-4" style={{ color: muted }}>
            Paste tab-separated data with player names in the first row and round scores below. Missing players will be created automatically.
          </p>
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            placeholder={'sam\tamber\tsofie\n14\t25\t10\n11\t11\t16'}
            className="w-full rounded-xl px-4 py-3 text-sm font-medium resize-y min-h-44 focus:outline-none mb-4"
            style={{ backgroundColor: '#111118', border: `1px solid ${border}`, color: '#fff' }}
          />
          {importError && <p className="text-sm mb-3" style={{ color: '#f87171' }}>{importError}</p>}
          <button
            onClick={importGame}
            disabled={!importText.trim()}
            className="px-6 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-all disabled:opacity-30"
            style={{ backgroundColor: '#e02020', color: '#fff' }}
          >
            Import Game
          </button>
        </div>
      )}

      {/* Games list */}
      <div className="space-y-2">
        {games.map(g => (
          <div key={g.id}
            className="rounded-xl overflow-hidden"
            style={{ border: `1px solid ${g.winner_name ? '#e02020' : border}` }}
          >
            {/* Winner banner for finished games */}
            {g.winner_name && (
              <div className="flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-widest"
                style={{ backgroundColor: '#e02020', color: '#fff' }}>
                <span>🏆</span>
                <span>{g.winner_name} wins!</span>
              </div>
            )}

            <div className="px-4 py-3 flex items-center justify-between"
              style={{ backgroundColor: surface }}>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-bold text-sm">Game #{g.id}</span>
                  {!g.finished_at && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                      style={{ backgroundColor: '#2a1010', color: '#fca5a5' }}>
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs" style={{ color: muted }}>
                  {new Date(g.started_at).toLocaleString()} · {g.round_count} rounds · {g.player_names}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setActiveGameId(g.id)}
                  className="text-sm font-black uppercase tracking-wide px-3 py-1.5 rounded-lg"
                  style={{ backgroundColor: '#e02020', color: '#fff' }}
                >
                  Open
                </button>
                {canEdit && (
                  <button
                    onClick={() => trashGame(g.id)}
                    className="text-xs font-medium transition-colors"
                    style={{ color: muted }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                    onMouseLeave={e => (e.currentTarget.style.color = muted)}
                  >
                    Trash
                  </button>
                )}
              </div>
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

      {canEdit && (
        <div className="rounded-2xl p-5 mt-8" style={{ backgroundColor: surface, border: `1px solid ${border}` }}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest mb-1" style={{ color: muted }}>Trash</p>
              <p className="text-sm" style={{ color: muted }}>
                Deleted games stay here until you permanently remove them. Trashed games are excluded from stats.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowTrash(prev => !prev)}
              className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wide"
              style={{ backgroundColor: '#111118', border: `1px solid ${border}`, color: '#fff' }}
            >
              {showTrash ? 'Hide Trash' : `Open Trash (${trashedGames.length})`}
            </button>
          </div>

          {showTrash && (
            trashedGames.length > 0 ? (
              <div className="space-y-2">
                {trashedGames.map(g => (
                  <div key={g.id}
                    className="rounded-xl px-4 py-3 flex items-center justify-between gap-4"
                    style={{ backgroundColor: '#111118', border: `1px solid ${border}` }}
                  >
                    <div>
                      <div className="font-bold text-sm">Game #{g.id}</div>
                      <p className="text-xs" style={{ color: muted }}>
                        {g.player_names} · {g.round_count} rounds · deleted {g.deleted_at ? new Date(g.deleted_at).toLocaleString() : 'recently'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <button
                        onClick={() => restoreGame(g.id)}
                        className="text-xs font-black uppercase tracking-wide px-3 py-1.5 rounded-lg"
                        style={{ backgroundColor: '#15502a', color: '#4ade80', border: '1px solid #1a6634' }}
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => permanentlyDeleteGame(g.id)}
                        className="text-xs font-medium transition-colors"
                        style={{ color: '#fca5a5' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#fca5a5')}
                      >
                        Delete Permanently
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm" style={{ color: muted }}>Trash is empty.</p>
            )
          )}
        </div>
      )}
    </div>
  );
}
