import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useFeedback } from '../feedback';
import type { Game } from '../types';
import { muted } from '../theme';
import { formatDate, formatDateTime } from '../lib/dates';

interface Props {
  canEdit: boolean;
  onOpenGame: (id: number) => void;
}

type StatusFilter = 'all' | 'active' | 'finished';

function winnerLabel(winners: string[]) {
  if (winners.length === 1) return `${winners[0]} wins!`;
  return `Tie: ${winners.join(' & ')}`;
}

export default function GamesListPage({ canEdit, onOpenGame }: Props) {
  const { toast, confirm } = useFeedback();
  const [games, setGames] = useState<Game[]>([]);
  const [trashedGames, setTrashedGames] = useState<Game[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [listError, setListError] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [showTrash, setShowTrash] = useState(false);

  const load = useCallback(() => {
    const trash: Promise<Game[]> = canEdit ? api.games.trash() : Promise.resolve([]);
    Promise.all([api.games.list(), trash])
      .then(([active, trashed]) => {
        setGames(active);
        setTrashedGames(trashed);
        setListError('');
      })
      .catch(err => setListError((err as Error).message))
      .finally(() => setLoaded(true));
  }, [canEdit]);

  useEffect(() => { load(); }, [load]);

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
      style={statusFilter === value ? { backgroundColor: 'var(--red)', color: '#fff' } : { color: muted }}
    >
      {label} <span className="opacity-70">{count}</span>
    </button>
  );

  return (
    <div>
      <div className="flex items-end justify-between gap-3 mb-5">
        <h2 className="text-2xl font-black uppercase tracking-wide">Previous games</h2>
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div role="group" aria-label="Filter games by status" className="flex rounded-xl overflow-hidden self-start surface">
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
            className="field w-full text-sm py-2"
          />
        </label>
      </div>

      <div className="space-y-3">
        {visibleGames.map((g, i) => {
          const winners = g.winners ?? [];
          return (
            <div
              key={g.id}
              className="surface card-lift rounded-2xl overflow-hidden anim-fade-up"
              style={{
                borderColor: winners.length > 0 ? 'rgba(255,59,59,0.45)' : undefined,
                '--delay': `${Math.min(i, 10) * 40}ms`,
              } as React.CSSProperties}
            >
              {winners.length > 0 && (
                <div className="shimmer flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-widest"
                  style={{ background: 'linear-gradient(135deg, var(--red-bright), var(--red))', color: '#fff' }}>
                  <span aria-hidden="true">🏆</span>
                  <span>{winnerLabel(winners)}</span>
                </div>
              )}

              <div className="px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="font-bold text-sm">Game #{g.id}</span>
                    {!g.finished_at && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-bold inline-flex items-center gap-1.5"
                        style={{ backgroundColor: '#2a1010', color: '#fca5a5' }}>
                        <span className="pulse-dot" style={{ width: 6, height: 6 }} aria-hidden="true" />
                        In progress
                      </span>
                    )}
                    {canEdit && g.group_name && <span className="pill-sm">{g.group_name}</span>}
                  </div>
                  <p className="text-xs truncate" style={{ color: muted }}>
                    {formatDate(g.started_at)}
                    {' · '}{g.round_count} {g.round_count === 1 ? 'round' : 'rounds'}
                    {' · '}{g.player_names}
                  </p>
                </div>
                <div className="flex items-center gap-4 sm:flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenGame(g.id)}
                    aria-label={`Open game ${g.id}`}
                    className={`w-full sm:w-auto text-sm font-black uppercase tracking-wide px-4 py-2 rounded-lg ${g.finished_at ? 'btn-ghost' : 'btn-primary'}`}
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
          <div className="text-center py-16 anim-fade-up" style={{ color: muted }}>
            <p className="text-sm">No games yet. Start one from the home screen.</p>
          </div>
        )}
        {games.length > 0 && visibleGames.length === 0 && (
          <p className="text-sm text-center py-10" style={{ color: muted }}>
            No games match{search ? ` “${search}”` : ''}{statusFilter !== 'all' ? ' in this filter' : ''}.
          </p>
        )}
      </div>

      {canEdit && (
        <div className="surface rounded-2xl p-4 sm:p-5 mt-10">
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
              className="btn-ghost text-xs whitespace-nowrap"
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
                    style={{ backgroundColor: 'var(--bg-2)', border: '1px solid var(--border)' }}
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-sm">Game #{g.id} {g.group_name && <span className="pill-sm ml-1">{g.group_name}</span>}</div>
                      <p className="text-xs truncate" style={{ color: muted }}>
                        {g.player_names} · {g.round_count} rounds · deleted {g.deleted_at ? formatDateTime(g.deleted_at) : 'recently'}
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
