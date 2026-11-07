import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { PlayerStats } from '../types';
import { PLAYER_COLORS, surface, border, muted } from '../theme';

const MEDALS = ['🥇', '🥈', '🥉'];
const POSITIVE = '#4ade80';
const NEGATIVE = '#f87171';

type SortKey = 'name' | 'total_score' | 'games_played' | 'wins' | 'win_rate' | 'avg_score_per_game' | 'avg_score_per_round' | 'best_round' | 'worst_round';

interface Column {
  key: SortKey;
  label: string;
  /** Whether the first click should sort descending (highest first). */
  numericDesc: boolean;
}

const COLUMNS: Column[] = [
  { key: 'name', label: 'Player', numericDesc: false },
  { key: 'total_score', label: 'Total', numericDesc: true },
  { key: 'games_played', label: 'Games', numericDesc: true },
  { key: 'wins', label: 'Wins', numericDesc: true },
  { key: 'win_rate', label: 'Win %', numericDesc: true },
  { key: 'avg_score_per_game', label: 'Avg / game', numericDesc: true },
  { key: 'avg_score_per_round', label: 'Avg / round', numericDesc: true },
  { key: 'best_round', label: 'Best', numericDesc: true },
  { key: 'worst_round', label: 'Worst', numericDesc: false },
];

function formatSigned(value: number | null) {
  if (value == null) return '—';
  return `${value > 0 ? '+' : ''}${value}`;
}

function winRate(s: PlayerStats) {
  return s.games_played === 0 ? 0 : Math.round((s.wins / s.games_played) * 1000) / 10;
}

/** Sort value for a row; null sorts last regardless of direction. */
function valueOf(s: PlayerStats, key: SortKey): number | string | null {
  switch (key) {
    case 'name': return s.name.toLowerCase();
    case 'total_score': return s.total_score;
    case 'games_played': return s.games_played;
    case 'wins': return s.wins;
    case 'win_rate': return winRate(s);
    case 'avg_score_per_game': return s.avg_score_per_game;
    case 'avg_score_per_round': return s.avg_score_per_round;
    case 'best_round': return s.best_round;
    case 'worst_round': return s.worst_round;
  }
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl p-3 min-w-[13rem] flex-shrink-0 sm:min-w-0" style={{ backgroundColor: surface, border: `1px solid ${border}` }}>
      <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color: muted }}>{label}</p>
      <p className="text-xl font-black truncate">{value}</p>
      <p className="text-xs mt-1 truncate" style={{ color: muted }}>{detail}</p>
    </div>
  );
}

export default function StatsPage() {
  const [stats, setStats] = useState<PlayerStats[] | null>(null);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('total_score');
  const [sortDesc, setSortDesc] = useState(true);

  const load = () => {
    api.stats.list()
      .then(s => { setStats(s); setError(''); })
      .catch(err => setError((err as Error).message));
  };

  useEffect(() => { load(); }, []);

  // Rank is always by total score, regardless of the current table sort.
  const ranked = useMemo(() => {
    const byTotal = [...(stats ?? [])].sort((a, b) => b.total_score - a.total_score || a.name.localeCompare(b.name));
    return byTotal.map((s, i) => ({ ...s, rank: i + 1 }));
  }, [stats]);

  const sorted = useMemo(() => {
    const dir = sortDesc ? -1 : 1;
    return [...ranked].sort((a, b) => {
      const av = valueOf(a, sortKey);
      const bv = valueOf(b, sortKey);
      if (av === bv) return a.name.localeCompare(b.name);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [ranked, sortKey, sortDesc]);

  const onSort = (column: Column) => {
    if (sortKey === column.key) {
      setSortDesc(prev => !prev);
    } else {
      setSortKey(column.key);
      setSortDesc(column.numericDesc);
    }
  };

  const withGames = ranked.filter(s => s.games_played > 0);
  const leader = ranked[0];
  const topWinner = withGames.length ? [...withGames].sort((a, b) => b.wins - a.wins)[0] : undefined;
  const mostWins = topWinner && topWinner.wins > 0 ? topWinner : undefined;
  const bestSingle = [...ranked].filter(s => s.best_round != null).sort((a, b) => (b.best_round ?? 0) - (a.best_round ?? 0))[0];

  return (
    <div>
      <h2 className="text-2xl font-black mb-6 uppercase tracking-wide">Statistics</h2>

      {error && (
        <div role="alert" className="rounded-xl px-4 py-3 mb-4 text-sm flex items-center justify-between gap-3"
          style={{ backgroundColor: '#2a1010', color: '#fca5a5' }}>
          <span>Could not load statistics: {error}</span>
          <button type="button" onClick={load} className="font-black uppercase text-xs underline underline-offset-4">Retry</button>
        </div>
      )}

      {stats === null && !error && <p className="text-sm" style={{ color: muted }}>Loading…</p>}

      {stats !== null && stats.length === 0 && (
        <div className="text-center py-16" style={{ color: muted }}>
          <p className="text-sm">No stats yet. Play some games!</p>
        </div>
      )}

      {stats !== null && stats.length > 0 && (
        <>
          {withGames.length > 0 && (
            <div className="flex gap-3 overflow-x-auto pb-1 mb-6 sm:grid sm:grid-cols-3 sm:overflow-visible">
              {leader && (
                <SummaryCard label="Top score" value={leader.name} detail={`${leader.total_score} points across ${leader.games_played} ${leader.games_played === 1 ? 'game' : 'games'}`} />
              )}
              {mostWins && (
                <SummaryCard label="Most wins" value={mostWins.name} detail={`${mostWins.wins} ${mostWins.wins === 1 ? 'win' : 'wins'} · ${winRate(mostWins)}% of games`} />
              )}
              {bestSingle && (
                <SummaryCard label="Best single round" value={`${formatSigned(bestSingle.best_round)} · ${bestSingle.name}`} detail="Highest score in any one round" />
              )}
            </div>
          )}

          <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${border}`, backgroundColor: surface }}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left">
                <thead>
                  <tr style={{ backgroundColor: '#171720' }}>
                    {COLUMNS.map(column => {
                      const active = sortKey === column.key;
                      const pinned = column.key === 'name';
                      return (
                        <th key={column.key} scope="col" className={`px-4 py-3 text-xs font-black uppercase tracking-widest whitespace-nowrap ${pinned ? 'sticky left-0 z-[1]' : ''}`}
                          aria-sort={active ? (sortDesc ? 'descending' : 'ascending') : 'none'}
                          style={{ color: active ? '#fff' : muted, backgroundColor: '#171720' }}>
                          <button type="button" onClick={() => onSort(column)}
                            className="inline-flex items-center gap-1 uppercase tracking-widest hover:text-white">
                            {column.label}
                            <span aria-hidden="true" className="opacity-70">
                              {active ? (sortDesc ? '↓' : '↑') : ''}
                            </span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(s => {
                    const c = PLAYER_COLORS[(s.rank - 1) % PLAYER_COLORS.length];
                    const medal = MEDALS[s.rank - 1];
                    return (
                      <tr key={s.id} style={{ borderTop: `1px solid ${border}` }}>
                        <td className="sticky left-0 z-[1] px-4 py-4" style={{ backgroundColor: surface }}>
                          <div className="flex items-center gap-3 whitespace-nowrap">
                            <div className="rounded-md font-black text-xs flex items-center justify-center flex-shrink-0"
                              style={{ width: 26, height: 34, backgroundColor: c.bg, color: c.text }}
                              aria-label={`Rank ${s.rank}`}>
                              {s.rank}
                            </div>
                            <span className="font-black text-base">{s.name}</span>
                            {medal && <span aria-hidden="true">{medal}</span>}
                          </div>
                        </td>
                        <td className="px-4 py-4 font-black text-2xl whitespace-nowrap"
                          style={{ color: s.total_score < 0 ? NEGATIVE : '#fff' }}>{s.total_score}</td>
                        <td className="px-4 py-4 text-sm font-bold whitespace-nowrap">{s.games_played}</td>
                        <td className="px-4 py-4 text-sm font-bold whitespace-nowrap">
                          {s.wins}
                          {s.ties > 0 && <span className="font-normal text-xs ml-1" style={{ color: muted }}>(+{s.ties} shared)</span>}
                        </td>
                        <td className="px-4 py-4 text-sm font-bold whitespace-nowrap">
                          {s.games_played > 0 ? `${winRate(s)}%` : '—'}
                        </td>
                        <td className="px-4 py-4 text-sm font-bold whitespace-nowrap">{s.avg_score_per_game}</td>
                        <td className="px-4 py-4 text-sm font-bold whitespace-nowrap">{s.avg_score_per_round}</td>
                        <td className="px-4 py-4 text-sm font-black whitespace-nowrap" style={{ color: POSITIVE }}>
                          {formatSigned(s.best_round)}
                        </td>
                        <td className="px-4 py-4 text-sm font-black whitespace-nowrap"
                          style={{ color: s.worst_round == null || s.worst_round >= 0 ? muted : NEGATIVE }}>
                          {formatSigned(s.worst_round)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs mt-3" style={{ color: muted }}>
            Counts finished and in-progress games; trashed games are excluded. Ties share a win.
          </p>
        </>
      )}
    </div>
  );
}
