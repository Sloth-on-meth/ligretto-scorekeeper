import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useFeedback } from '../feedback';
import type { Game, Player } from '../types';
import GameView from './GameView';
import { PLAYER_COLORS, surface, border, muted } from '../theme';
import { parseImportedGame } from '../lib/importParser';

interface Props {
  canEdit: boolean;
  canPlay: boolean;
}

type StatusFilter = 'all' | 'active' | 'finished';

function winnerLabel(winners: string[]) {
  if (winners.length === 1) return `${winners[0]} wins!`;
  return `Tie: ${winners.join(' & ')}`;
}

function playerNamesOf(game: Game) {
  return (game.player_names ?? '').split(', ').filter(Boolean);
}

export default function GamesPage({ canEdit, canPlay }: Props) {
  const { toast, confirm } = useFeedback();
  const [games, setGames] = useState<Game[]>([]);
  const [trashedGames, setTrashedGames] = useState<Game[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedPlayers, setSelectedPlayers] = useState<number[]>([]);
  const [activeGameId, setActiveGameId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [showTrash, setShowTrash] = useState(false);
  const [starting, setStarting] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.games.list(), api.games.trash(), api.players.list()])
      .then(([active, trashed, all]) => {
        setGames(active);
        setTrashedGames(trashed);
        setPlayers(all);
        setListError('');
      })
      .catch(err => setListError((err as Error).message))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Ignore selections for players that no longer exist (e.g. after a delete elsewhere).
  const selected = selectedPlayers.filter(id => players.some(p => p.id === id));

  const togglePlayer = (id: number) => {
    setSelectedPlayers(prev => (prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]));
  };

  const latestGame = games[0];
  const lastLineupIds = latestGame
    ? players.filter(p => playerNamesOf(latestGame).includes(p.name)).map(p => p.id)
    : [];
  const alreadySelected = lastLineupIds.length === selected.length && lastLineupIds.every(id => selected.includes(id));
  const canRepeatLineup = lastLineupIds.length >= 2 && !alreadySelected;

  const startGame = async () => {
    setError('');
    if (selected.length < 2) return setError('Select at least 2 players to start a game.');
    setStarting(true);
    try {
      const game = await api.games.create(selected);
      setSelectedPlayers([]);
      setActiveGameId(game.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const trashGame = async (id: number) => {
    const ok = await confirm({
      title: `Move game #${id} to the trash?`,
      message: 'You can restore it later. Trashed games are excluded from stats.',
      confirmLabel: 'Move to trash',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.games.trashOne(id);
      toast(`Game #${id} moved to trash`);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    load();
  };

  const restoreGame = async (id: number) => {
    try {
      await api.games.restore(id);
      toast(`Game #${id} restored`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    load();
  };

  const permanentlyDeleteGame = async (id: number) => {
    const ok = await confirm({
      title: `Permanently delete game #${id}?`,
      message: 'This erases the game, all of its rounds and scores. This cannot be undone.',
      confirmLabel: 'Delete forever',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.games.delete(id);
      toast(`Game #${id} deleted`);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    load();
  };

  // Live preview of what the pasted text will import.
  const importPreview = useMemo(() => {
    if (!importText.trim()) return null;
    try {
      return { ok: true as const, parsed: parseImportedGame(importText) };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  }, [importText]);

  const importGame = async () => {
    if (!importPreview?.ok) return;
    const { parsed } = importPreview;
    setImporting(true);
    try {
      const game = await api.games.import(parsed.playerNames, parsed.rounds);
      setImportText('');
      toast(`Imported game #${game.id}`, 'success');
      setActiveGameId(game.id);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setImporting(false);
    }
  };

  if (activeGameId !== null) {
    return <GameView gameId={activeGameId} canEdit={canEdit} canPlay={canPlay} onBack={() => { setActiveGameId(null); load(); }} />;
  }

  const activeCount = games.filter(g => !g.finished_at).length;
  const finishedCount = games.length - activeCount;

  const visibleGames = games.filter(g => {
    if (statusFilter === 'active' && g.finished_at) return false;
    if (statusFilter === 'finished' && !g.finished_at) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `game ${g.id}`.includes(q) || (g.player_names ?? '').toLowerCase().includes(q);
  });

  const filterButton = (value: StatusFilter, label: string, count: number) => (
    <button
      type="button"
      onClick={() => setStatusFilter(value)}
      aria-pressed={statusFilter === value}
      className="px-3 py-1.5 text-xs font-black uppercase tracking-wide transition-all whitespace-nowrap"
      style={statusFilter === value ? { backgroundColor: '#e02020', color: '#fff' } : { color: muted }}
    >
      {label} <span className="opacity-70">{count}</span>
    </button>
  );

  return (
    <div>
      <div className="flex items-end justify-between gap-3 mb-5">
        <h2 className="text-2xl font-black uppercase tracking-wide">Games</h2>
        <p className="text-xs font-medium text-right" style={{ color: muted }}>
          {activeCount} in progress · {finishedCount} finished{canEdit ? ` · ${trashedGames.length} trashed` : ''}
        </p>
      </div>

      {listError && (
        <div role="alert" className="rounded-xl px-4 py-3 mb-4 text-sm flex items-center justify-between gap-3"
          style={{ backgroundColor: '#2a1010', color: '#fca5a5' }}>
          <span>Could not load games: {listError}</span>
          <button type="button" onClick={load} className="font-black uppercase text-xs underline underline-offset-4">Retry</button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 mb-8">
        {/* New game panel */}
        <div className="rounded-2xl p-4 sm:p-5" style={{ backgroundColor: surface, border: `1px solid ${border}` }}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <p className="text-xs font-black uppercase tracking-widest" style={{ color: muted }}>New game</p>
            {canPlay && canRepeatLineup && (
              <button type="button" onClick={() => setSelectedPlayers(lastLineupIds)}
                className="text-xs font-bold underline underline-offset-4 text-white">
                Repeat last lineup
              </button>
            )}
          </div>

          {!canPlay ? (
            <p className="text-sm" style={{ color: muted }}>Read-only. Sign in to start a game.</p>
          ) : players.length < 2 ? (
            <p className="text-sm" style={{ color: muted }}>Add at least 2 players on the Players tab first.</p>
          ) : (
            <>
              <p className="text-xs mb-3" style={{ color: muted }}>Tap players in seating order.</p>
              <div className="flex flex-wrap gap-2 mb-5" role="group" aria-label="Players in this game">
                {players.map((p, i) => {
                  const c = PLAYER_COLORS[i % PLAYER_COLORS.length];
                  const seat = selected.indexOf(p.id);
                  const sel = seat !== -1;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePlayer(p.id)}
                      aria-pressed={sel}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold transition-all"
                      style={sel
                        ? { backgroundColor: c.bg, color: c.text, boxShadow: `0 0 0 2px ${c.bg}40` }
                        : { backgroundColor: '#111118', color: muted, border: `1px solid ${border}` }
                      }
                    >
                      <span className="rounded font-black text-xs flex items-center justify-center"
                        style={{ width: 18, height: 22, backgroundColor: sel ? 'rgba(0,0,0,0.25)' : c.bg, color: '#fff', fontSize: '0.6rem' }}
                        aria-hidden="true">
                        {sel ? seat + 1 : i + 1}
                      </span>
                      {p.name}
                    </button>
                  );
                })}
              </div>
              {error && <p className="text-sm mb-3" style={{ color: '#f87171' }} role="alert">{error}</p>}
              <div className="flex items-center gap-4">
                <button
                  onClick={startGame}
                  disabled={selected.length < 2 || starting}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-all disabled:opacity-30"
                  style={{ backgroundColor: '#e02020', color: '#fff' }}
                >
                  {starting ? 'Starting…' : `Start — ${selected.length} ${selected.length === 1 ? 'player' : 'players'}`}
                </button>
                {selected.length > 0 && (
                  <button type="button" onClick={() => setSelectedPlayers([])} className="text-xs font-bold" style={{ color: muted }}>
                    Clear
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Import panel */}
        {canEdit && (
          <div className="rounded-2xl p-4 sm:p-5" style={{ backgroundColor: surface, border: `1px solid ${border}` }}>
            <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color: muted }}>Import a finished game</p>
            <p className="text-sm mb-4" style={{ color: muted }}>
              Paste names in the first row and one row of scores per round. Tabs, commas or semicolons all work. Unknown players are created for you.
            </p>
            <label htmlFor="import-text" className="sr-only">Scores to import</label>
            <textarea
              id="import-text"
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder={'sam\tamber\tsofie\n14\t25\t10\n11\t11\t16'}
              spellCheck={false}
              className="w-full rounded-xl px-4 py-3 text-sm font-mono resize-y min-h-40 focus:outline-none mb-3"
              style={{ backgroundColor: '#111118', border: `1px solid ${border}`, color: '#fff' }}
            />
            {importPreview && (
              importPreview.ok ? (
                <p className="text-xs mb-3 font-bold" style={{ color: '#4ade80' }} role="status">
                  Ready: {importPreview.parsed.playerNames.length} players, {importPreview.parsed.rounds.length} rounds
                  <span className="font-normal" style={{ color: muted }}> ({importPreview.parsed.delimiterLabel}-separated)</span>
                </p>
              ) : (
                <p className="text-xs mb-3" style={{ color: '#f87171' }} role="alert">{importPreview.message}</p>
              )
            )}
            <div className="flex items-center gap-4">
              <button
                onClick={importGame}
                disabled={!importPreview?.ok || importing}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-all disabled:opacity-30"
                style={{ backgroundColor: '#e02020', color: '#fff' }}
              >
                {importing ? 'Importing…' : 'Import game'}
              </button>
              {importText && (
                <button type="button" onClick={() => setImportText('')} className="text-xs font-bold" style={{ color: muted }}>
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div role="group" aria-label="Filter games by status" className="flex rounded-xl overflow-hidden self-start"
          style={{ border: `1px solid ${border}` }}>
          {filterButton('all', 'All', games.length)}
          {filterButton('active', 'In progress', activeCount)}
          {filterButton('finished', 'Finished', finishedCount)}
        </div>
        <label className="sm:w-64">
          <span className="sr-only">Search games</span>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by player or game #"
            className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
            style={{ backgroundColor: surface, border: `1px solid ${border}`, color: '#fff' }}
          />
        </label>
      </div>

      {/* Games list */}
      <div className="space-y-3">
        {visibleGames.map(g => {
          const winners = g.winners ?? [];
          return (
            <div key={g.id}
              className="rounded-xl overflow-hidden"
              style={{ border: `1px solid ${winners.length > 0 ? '#e02020' : border}` }}
            >
              {winners.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-widest"
                  style={{ backgroundColor: '#e02020', color: '#fff' }}>
                  <span aria-hidden="true">🏆</span>
                  <span>{winnerLabel(winners)}</span>
                </div>
              )}

              <div className="px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                style={{ backgroundColor: surface }}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-bold text-sm">Game #{g.id}</span>
                    {!g.finished_at && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                        style={{ backgroundColor: '#2a1010', color: '#fca5a5' }}>
                        In progress
                      </span>
                    )}
                  </div>
                  <p className="text-xs truncate" style={{ color: muted }}>
                    {new Date(g.started_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                    {' · '}{g.round_count} {g.round_count === 1 ? 'round' : 'rounds'}
                    {' · '}{g.player_names}
                  </p>
                </div>
                <div className="flex items-center gap-4 sm:flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveGameId(g.id)}
                    aria-label={`Open game ${g.id}`}
                    className="w-full sm:w-auto text-sm font-black uppercase tracking-wide px-4 py-2 rounded-lg"
                    style={g.finished_at
                      ? { backgroundColor: '#111118', color: '#fff', border: `1px solid ${border}` }
                      : { backgroundColor: '#e02020', color: '#fff' }}
                  >
                    {g.finished_at ? 'View' : 'Continue'}
                  </button>
                  {canEdit && (
                    <button
                      onClick={() => trashGame(g.id)}
                      aria-label={`Move game ${g.id} to trash`}
                      className="text-xs font-medium transition-colors whitespace-nowrap"
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
          );
        })}

        {loaded && games.length === 0 && (
          <div className="text-center py-16" style={{ color: muted }}>
            <div className="flex justify-center gap-1 mb-4" aria-hidden="true">
              {['#c81818', '#1844c8', '#18a030', '#c89800'].map((c, i) => (
                <div key={i} className="rounded-xl font-black text-2xl flex items-center justify-center"
                  style={{ width: 52, height: 70, backgroundColor: c, color: '#fff', opacity: 0.4, transform: `rotate(${(i - 1.5) * 8}deg)` }}>
                  {i + 1}
                </div>
              ))}
            </div>
            <p className="text-sm mt-6">No games yet. {canPlay ? 'Start one above.' : 'Sign in to start one.'}</p>
          </div>
        )}
        {games.length > 0 && visibleGames.length === 0 && (
          <p className="text-sm text-center py-10" style={{ color: muted }}>
            No games match{search ? ` “${search}”` : ''}{statusFilter !== 'all' ? ` in this filter` : ''}.
          </p>
        )}
      </div>

      {canEdit && (
        <div className="rounded-2xl p-4 sm:p-5 mt-10" style={{ backgroundColor: surface, border: `1px solid ${border}` }}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest mb-1" style={{ color: muted }}>Trash</p>
              <p className="text-sm" style={{ color: muted }}>
                Trashed games are hidden and excluded from stats until restored.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowTrash(prev => !prev)}
              aria-expanded={showTrash}
              className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wide whitespace-nowrap"
              style={{ backgroundColor: '#111118', border: `1px solid ${border}`, color: '#fff' }}
            >
              {showTrash ? 'Hide' : `Show (${trashedGames.length})`}
            </button>
          </div>

          {showTrash && (
            trashedGames.length > 0 ? (
              <div className="space-y-2">
                {trashedGames.map(g => (
                  <div key={g.id}
                    className="rounded-xl px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                    style={{ backgroundColor: '#111118', border: `1px solid ${border}` }}
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-sm">Game #{g.id}</div>
                      <p className="text-xs truncate" style={{ color: muted }}>
                        {g.player_names} · {g.round_count} rounds · deleted {g.deleted_at ? new Date(g.deleted_at).toLocaleString() : 'recently'}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <button
                        onClick={() => restoreGame(g.id)}
                        aria-label={`Restore game ${g.id}`}
                        className="text-xs font-black uppercase tracking-wide px-3 py-1.5 rounded-lg"
                        style={{ backgroundColor: '#15502a', color: '#4ade80', border: '1px solid #1a6634' }}
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => permanentlyDeleteGame(g.id)}
                        aria-label={`Permanently delete game ${g.id}`}
                        className="text-xs font-medium transition-colors"
                        style={{ color: '#fca5a5' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#fca5a5')}
                      >
                        Delete forever
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
