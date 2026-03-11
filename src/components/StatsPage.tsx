import { useEffect, useState } from 'react';
import { api } from '../api';
import type { PlayerStats } from '../types';

export default function StatsPage() {
  const [stats, setStats] = useState<PlayerStats[]>([]);

  useEffect(() => { api.stats.list().then(setStats); }, []);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Player Statistics</h2>
      {stats.length === 0 ? (
        <p className="text-slate-400 text-sm text-center py-8">No stats yet. Play some games!</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700">
                <th className="text-left py-2 pr-4">#</th>
                <th className="text-left py-2 pr-4">Player</th>
                <th className="text-right py-2 pr-4">Games</th>
                <th className="text-right py-2 pr-4">Rounds</th>
                <th className="text-right py-2 pr-4">Total</th>
                <th className="text-right py-2 pr-4">Avg/Round</th>
                <th className="text-right py-2 pr-4">Best</th>
                <th className="text-right py-2">Worst</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s, i) => (
                <tr key={s.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                  <td className="py-3 pr-4 text-slate-400">{i + 1}</td>
                  <td className="py-3 pr-4 font-medium">{s.name}</td>
                  <td className="py-3 pr-4 text-right">{s.games_played}</td>
                  <td className="py-3 pr-4 text-right">{s.rounds_played}</td>
                  <td className="py-3 pr-4 text-right font-bold text-blue-400">{s.total_score}</td>
                  <td className="py-3 pr-4 text-right">{s.avg_score_per_round}</td>
                  <td className="py-3 pr-4 text-right text-green-400">{s.best_round ?? '—'}</td>
                  <td className="py-3 text-right text-red-400">{s.worst_round ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
