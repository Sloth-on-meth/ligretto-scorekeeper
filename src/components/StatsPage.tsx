import { useEffect, useState } from 'react';
import { api } from '../api';
import type { PlayerStats } from '../types';
import { PLAYER_COLORS, surface, border, muted } from '../theme';

const MEDALS = ['🥇', '🥈', '🥉'];

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
        <div className="space-y-3">
          {stats.map((s, i) => {
            const c = PLAYER_COLORS[i % PLAYER_COLORS.length];
            return (
              <div key={s.id} className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${border}` }}>
                {/* Player header stripe */}
                <div className="flex items-center justify-between px-4 py-3"
                  style={{ backgroundColor: c.bg }}>
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{MEDALS[i] ?? `#${i + 1}`}</span>
                    <span className="font-black text-lg text-white">{s.name}</span>
                  </div>
                  <div className="font-black text-3xl text-white">{s.total_score}</div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-4 divide-x" style={{ backgroundColor: surface, borderColor: border }}>
                  {[
                    { label: 'Games', value: s.games_played },
                    { label: 'Rounds', value: s.rounds_played },
                    { label: 'Avg/Rd', value: s.avg_score_per_round },
                    { label: 'Best', value: s.best_round != null ? `+${s.best_round}` : '—', highlight: '#4ade80' },
                  ].map(stat => (
                    <div key={stat.label} className="text-center py-3 px-2"
                      style={{ borderColor: border }}>
                      <div className="font-black text-lg" style={{ color: stat.highlight ?? '#fff' }}>
                        {stat.value}
                      </div>
                      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: muted }}>
                        {stat.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
