import { useEffect, useState } from 'react';
import { api } from '../api';
import type { PlayerStats } from '../types';
import { PLAYER_COLORS, surface, border, muted } from '../theme';

const MEDALS = ['🥇', '🥈', '🥉'];
const POSITIVE = '#4ade80';
const NEGATIVE = '#f87171';

function formatSigned(value: number | null) {
  if (value == null) return '—';
  return `${value > 0 ? '+' : ''}${value}`;
}

export default function StatsPage() {
  const [stats, setStats] = useState<PlayerStats[]>([]);

  useEffect(() => { api.stats.list().then(setStats); }, []);

  return (
    <div>
      <h2 className="text-2xl font-black mb-6 uppercase tracking-wide">Statistics</h2>

      {stats.length === 0 ? (
        <div className="text-center py-16" style={{ color: muted }}>
          <p className="text-sm">No stats yet. Play some games!</p>
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${border}`, backgroundColor: surface }}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr style={{ backgroundColor: '#171720' }}>
                  {['Rank', 'Player', 'Total', 'Games', 'Rounds', 'Avg/Rd', 'Best', 'Worst'].map(label => (
                    <th
                      key={label}
                      className="px-4 py-3 text-left text-xs font-black uppercase tracking-widest"
                      style={{ color: muted }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.map((s, i) => {
                  const c = PLAYER_COLORS[i % PLAYER_COLORS.length];
                  return (
                    <tr key={s.id} style={{ borderTop: `1px solid ${border}` }}>
                      <td className="px-4 py-4 text-sm font-black whitespace-nowrap" style={{ color: muted }}>
                        {MEDALS[i] ?? `#${i + 1}`}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div
                            className="rounded-md font-black text-xs flex items-center justify-center flex-shrink-0"
                            style={{ width: 26, height: 34, backgroundColor: c.bg, color: c.text }}
                          >
                            {i + 1}
                          </div>
                          <span className="font-black text-base">{s.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 font-black text-2xl whitespace-nowrap">{s.total_score}</td>
                      <td className="px-4 py-4 text-sm font-bold whitespace-nowrap">{s.games_played}</td>
                      <td className="px-4 py-4 text-sm font-bold whitespace-nowrap">{s.rounds_played}</td>
                      <td className="px-4 py-4 text-sm font-bold whitespace-nowrap">{s.avg_score_per_round}</td>
                      <td className="px-4 py-4 text-sm font-black whitespace-nowrap" style={{ color: POSITIVE }}>
                        {formatSigned(s.best_round)}
                      </td>
                      <td className="px-4 py-4 text-sm font-black whitespace-nowrap" style={{ color: s.worst_round == null || s.worst_round >= 0 ? muted : NEGATIVE }}>
                        {formatSigned(s.worst_round)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
