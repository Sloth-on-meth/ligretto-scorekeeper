import { useEffect, useState } from 'react';
import { api } from '../api';
import type { GameDetail, RoundScore } from '../types';

interface Props {
  gameId: number;
  onBack: () => void;
}

type InputMode = 'formula' | 'direct';

export default function GameView({ gameId, onBack }: Props) {
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [mode, setMode] = useState<InputMode>('formula');
  const [formulaInputs, setFormulaInputs] = useState<Record<number, { cards_played: string; cards_in_hand: string }>>({});
  const [directInputs, setDirectInputs] = useState<Record<number, string>>({});
  const [error, setError] = useState('');

  const load = () => api.games.get(gameId).then(d => {
    setDetail(d);
    const fi: typeof formulaInputs = {};
    const di: typeof directInputs = {};
    d.players.forEach(p => {
      fi[p.id] = { cards_played: '', cards_in_hand: '' };
      di[p.id] = '';
    });
    setFormulaInputs(fi);
    setDirectInputs(di);
  });

  useEffect(() => { load(); }, [gameId]);

  if (!detail) return <p className="text-slate-400">Loading...</p>;

  const { game, players, rounds } = detail;

  const roundNumbers = [...new Set(rounds.map(r => r.round_number))].sort((a, b) => a - b);
  const scoreMap: Record<number, Record<number, RoundScore>> = {};
  rounds.forEach(r => {
    if (!scoreMap[r.round_number]) scoreMap[r.round_number] = {};
    scoreMap[r.round_number][r.player_id] = r;
  });

  const roundIdMap: Record<number, number> = {};
  rounds.forEach(r => { roundIdMap[r.round_number] = r.id; });

  const totals: Record<number, number> = {};
  players.forEach(p => {
    totals[p.id] = rounds.filter(r => r.player_id === p.id).reduce((s, r) => s + r.score, 0);
  });

  const sortedPlayers = [...players].sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0));

  const submitRound = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    let scores: { player_id: number; score?: number; cards_played?: number; cards_in_hand?: number }[];

    if (mode === 'direct') {
      scores = players.map(p => ({ player_id: p.id, score: parseInt(directInputs[p.id] ?? '') }));
      if (scores.some(s => isNaN(s.score!))) return setError('Fill in all scores');
    } else {
      scores = players.map(p => ({
        player_id: p.id,
        cards_played: parseInt(formulaInputs[p.id]?.cards_played ?? ''),
        cards_in_hand: parseInt(formulaInputs[p.id]?.cards_in_hand ?? ''),
      }));
      if (scores.some(s => isNaN(s.cards_played!) || isNaN(s.cards_in_hand!))) {
        return setError('Fill in all scores');
      }
    }

    try {
      await api.rounds.add(gameId, scores);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const deleteRound = async (roundId: number) => {
    await api.rounds.delete(gameId, roundId);
    load();
  };

  const finishGame = async () => {
    await api.games.finish(gameId);
    load();
  };

  const scoreColor = (s: number) => s >= 0 ? 'text-green-400' : 'text-red-400';
  const fmtScore = (s: number) => `${s > 0 ? '+' : ''}${s}`;

  return (
    <div>
      <button onClick={onBack} className="text-slate-400 hover:text-white text-sm mb-4 flex items-center gap-1">
        ← Back to games
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Game #{game.id}</h2>
          <p className="text-slate-400 text-sm">{new Date(game.started_at).toLocaleString()}</p>
        </div>
        {!game.finished_at && (
          <button
            onClick={finishGame}
            className="bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Finish Game
          </button>
        )}
        {game.finished_at && <span className="text-green-400 text-sm font-medium">Finished</span>}
      </div>

      {/* Scoreboard */}
      {roundNumbers.length > 0 && (
        <div className="overflow-x-auto mb-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700">
                <th className="text-left py-2 pr-4">Player</th>
                {roundNumbers.map(r => (
                  <th key={r} className="text-right py-2 px-2">
                    <div className="flex flex-col items-end gap-0.5">
                      <span>R{r}</span>
                      {!game.finished_at && (
                        <button
                          onClick={() => deleteRound(roundIdMap[r])}
                          className="text-slate-600 hover:text-red-400 text-xs leading-none"
                          title="Delete round"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </th>
                ))}
                <th className="text-right py-2 pl-4 font-bold text-blue-400">Total</th>
              </tr>
            </thead>
            <tbody>
              {sortedPlayers.map(p => (
                <tr key={p.id} className="border-b border-slate-800">
                  <td className="py-3 pr-4 font-medium">{p.name}</td>
                  {roundNumbers.map(r => {
                    const s = scoreMap[r]?.[p.id];
                    return (
                      <td key={r} className="py-3 px-2 text-right">
                        {s ? (
                          <span
                            className={scoreColor(s.score)}
                            title={s.cards_played != null ? `Played: ${s.cards_played}, In hand: ${s.cards_in_hand}` : undefined}
                          >
                            {fmtScore(s.score)}
                          </span>
                        ) : '—'}
                      </td>
                    );
                  })}
                  <td className="py-3 pl-4 text-right font-bold text-blue-400">{totals[p.id] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add round form */}
      {!game.finished_at && (
        <div className="bg-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Round {roundNumbers.length + 1}</h3>
            <div className="flex rounded-lg overflow-hidden border border-slate-600 text-xs font-medium">
              <button
                type="button"
                onClick={() => setMode('formula')}
                className={`px-3 py-1.5 transition-colors ${mode === 'formula' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                Played / In hand
              </button>
              <button
                type="button"
                onClick={() => setMode('direct')}
                className={`px-3 py-1.5 transition-colors ${mode === 'direct' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                Direct score
              </button>
            </div>
          </div>

          <form onSubmit={submitRound}>
            <div className="grid gap-3 mb-4">
              {players.map(p => (
                <div key={p.id} className="flex items-center gap-3">
                  <span className="w-28 text-sm font-medium truncate">{p.name}</span>

                  {mode === 'formula' ? (
                    <div className="flex items-center gap-2 flex-1">
                      <div className="flex-1">
                        <label className="text-xs text-slate-400 block mb-1">Played</label>
                        <input
                          type="number"
                          min="0"
                          className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                          value={formulaInputs[p.id]?.cards_played ?? ''}
                          onChange={e => setFormulaInputs(prev => ({
                            ...prev,
                            [p.id]: { ...prev[p.id], cards_played: e.target.value }
                          }))}
                          required
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-slate-400 block mb-1">In hand</label>
                        <input
                          type="number"
                          min="0"
                          className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                          value={formulaInputs[p.id]?.cards_in_hand ?? ''}
                          onChange={e => setFormulaInputs(prev => ({
                            ...prev,
                            [p.id]: { ...prev[p.id], cards_in_hand: e.target.value }
                          }))}
                          required
                        />
                      </div>
                      <div className="w-14 text-right">
                        <label className="text-xs text-slate-400 block mb-1">Score</label>
                        <span className="text-sm font-mono">
                          {formulaInputs[p.id]?.cards_played !== '' && formulaInputs[p.id]?.cards_in_hand !== ''
                            ? (() => {
                                const s = parseInt(formulaInputs[p.id].cards_played) - parseInt(formulaInputs[p.id].cards_in_hand) * 2;
                                return <span className={scoreColor(s)}>{fmtScore(s)}</span>;
                              })()
                            : <span className="text-slate-500">—</span>}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1">
                      <label className="text-xs text-slate-400 block mb-1">Score</label>
                      <input
                        type="number"
                        className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                        value={directInputs[p.id] ?? ''}
                        onChange={e => setDirectInputs(prev => ({ ...prev, [p.id]: e.target.value }))}
                        required
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium w-full"
            >
              Save Round
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
