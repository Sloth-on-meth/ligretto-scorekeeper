import { useEffect, useState } from 'react';
import { api } from '../api';
import type { PlayerStats } from '../types';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function StatsPage() {
  const [stats, setStats] = useState<PlayerStats[]>([]);

  useEffect(() => { api.stats.list().then(setStats); }, []);

  return (
    <div>
      <h2 className="text-2xl font-black tracking-wide mb-6" style={{ color: '#f8f4ec' }}>
        ♦ Statistics
      </h2>
      {stats.length === 0 ? (
        <div className="text-center py-12" style={{ color: '#6b9e7e' }}>
          <div className="text-4xl mb-3">♦</div>
          <p className="text-sm">No stats yet. Play some games!</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid #1f5038', color: '#6b9e7e' }}>
                <th className="text-left py-2 pr-4">#</th>
                <th className="text-left py-2 pr-4">Player</th>
                <th className="text-right py-2 pr-4">Games</th>
                <th className="text-right py-2 pr-4">Rounds</th>
                <th className="text-right py-2 pr-4 font-bold" style={{ color: '#f59e0b' }}>Total</th>
                <th className="text-right py-2 pr-4">Avg/Rd</th>
                <th className="text-right py-2 pr-4">Best</th>
                <th className="text-right py-2">Worst</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s, i) => (
                <tr
                  key={s.id}
                  style={{ borderBottom: '1px solid #163d2a' }}
                  className="transition-colors"
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(15,46,32,0.8)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <td className="py-3 pr-4" style={{ color: '#6b9e7e' }}>
                    {MEDALS[i] ?? i + 1}
                  </td>
                  <td className="py-3 pr-4 font-bold">{s.name}</td>
                  <td className="py-3 pr-4 text-right" style={{ color: '#a7c4b5' }}>{s.games_played}</td>
                  <td className="py-3 pr-4 text-right" style={{ color: '#a7c4b5' }}>{s.rounds_played}</td>
                  <td className="py-3 pr-4 text-right font-black text-lg" style={{ color: '#f59e0b' }}>
                    {s.total_score}
                  </td>
                  <td className="py-3 pr-4 text-right" style={{ color: '#a7c4b5' }}>{s.avg_score_per_round}</td>
                  <td className="py-3 pr-4 text-right font-semibold" style={{ color: '#4ade80' }}>
                    {s.best_round != null ? `+${s.best_round > 0 ? '' : ''}${s.best_round}` : '—'}
                  </td>
                  <td className="py-3 text-right font-semibold" style={{ color: '#f87171' }}>
                    {s.worst_round ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
