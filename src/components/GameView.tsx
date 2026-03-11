import { useEffect, useState } from 'react';
import { api } from '../api';
import type { GameDetail, RoundScore } from '../types';
import { PLAYER_COLORS, surface, border, muted } from '../theme';

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

  if (!detail) return <p style={{ color: muted }}>Loading…</p>;

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
  // Map player id -> color index (by sorted position, stable across re-renders by player id)
  const playerColorIndex: Record<number, number> = {};
  players.forEach((p, i) => { playerColorIndex[p.id] = i % PLAYER_COLORS.length; });

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

  const scoreColor = (s: number) => s >= 0 ? '#4ade80' : '#f87171';
  const fmtScore = (s: number) => `${s > 0 ? '+' : ''}${s}`;

  const inputStyle: React.CSSProperties = {
    backgroundColor: '#111118',
    border: `1px solid ${border}`,
    borderRadius: 8,
    color: '#fff',
    width: '100%',
    padding: '7px 10px',
    fontSize: '0.875rem',
  };

  return (
    <div>
      <button
        onClick={onBack}
        className="text-sm font-bold mb-5 flex items-center gap-1 transition-colors"
        style={{ color: muted }}
        onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
        onMouseLeave={e => (e.currentTarget.style.color = muted)}
      >
        ← All games
      </button>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-wide">Game #{game.id}</h2>
          <p className="text-xs mt-0.5" style={{ color: muted }}>
            {new Date(game.started_at).toLocaleString()} · {roundNumbers.length} rounds
          </p>
        </div>
        {!game.finished_at ? (
          <button onClick={finishGame}
            className="px-4 py-2 rounded-xl text-sm font-black uppercase tracking-wide"
            style={{ backgroundColor: '#15502a', color: '#4ade80', border: '1px solid #1a6634' }}>
            Finish ✓
          </button>
        ) : (
          <span className="px-3 py-1.5 rounded-xl text-xs font-black uppercase"
            style={{ backgroundColor: '#15502a', color: '#4ade80' }}>
            Finished
          </span>
        )}
      </div>

      {/* Scoreboard */}
      {roundNumbers.length > 0 && (
        <div className="rounded-2xl overflow-hidden mb-8" style={{ border: `1px solid ${border}` }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: '#1a1a24' }}>
                <th className="text-left py-3 px-4 text-xs font-black uppercase tracking-widest" style={{ color: muted }}>
                  Player
                </th>
                {roundNumbers.map(r => (
                  <th key={r} className="text-center py-3 px-2" style={{ color: muted }}>
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-xs font-black uppercase tracking-wide">R{r}</span>
                      {!game.finished_at && (
                        <button onClick={() => deleteRound(roundIdMap[r])}
                          className="text-xs leading-none transition-colors"
                          style={{ color: border }}
                          title="Delete round"
                          onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                          onMouseLeave={e => (e.currentTarget.style.color = border)}>
                          ✕
                        </button>
                      )}
                    </div>
                  </th>
                ))}
                <th className="text-right py-3 px-4 text-xs font-black uppercase tracking-widest" style={{ color: muted }}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedPlayers.map((p, rank) => {
                const c = PLAYER_COLORS[playerColorIndex[p.id]];
                return (
                  <tr key={p.id} style={{ borderTop: `1px solid ${border}` }}>
                    {/* Player name cell with color stripe */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="rounded-md font-black text-xs flex items-center justify-center flex-shrink-0"
                          style={{ width: 26, height: 34, backgroundColor: c.bg, color: c.text, boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }}>
                          {rank === 0 ? '🏆' : rank + 1}
                        </div>
                        <span className="font-bold truncate">{p.name}</span>
                      </div>
                    </td>
                    {roundNumbers.map(r => {
                      const s = scoreMap[r]?.[p.id];
                      return (
                        <td key={r} className="py-3 px-2 text-center font-mono text-sm">
                          {s ? (
                            <span style={{ color: scoreColor(s.score) }}
                              title={s.cards_played != null ? `Played: ${s.cards_played}, In hand: ${s.cards_in_hand}` : undefined}>
                              {fmtScore(s.score)}
                            </span>
                          ) : <span style={{ color: border }}>—</span>}
                        </td>
                      );
                    })}
                    <td className="py-3 px-4 text-right font-black text-lg" style={{ color: c.bg === '#c89800' ? '#d4a500' : c.bg }}>
                      {totals[p.id] ?? 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Round entry form */}
      {!game.finished_at && (
        <div className="rounded-2xl p-5" style={{ backgroundColor: surface, border: `1px solid ${border}` }}>
          <div className="flex items-center justify-between mb-5">
            <p className="text-xs font-black uppercase tracking-widest" style={{ color: muted }}>
              Round {roundNumbers.length + 1}
            </p>
            {/* Mode toggle */}
            <div className="flex rounded-xl overflow-hidden text-xs font-black uppercase tracking-wide"
              style={{ border: `1px solid ${border}` }}>
              <button type="button" onClick={() => setMode('formula')}
                className="px-3 py-1.5 transition-all"
                style={mode === 'formula' ? { backgroundColor: '#e02020', color: '#fff' } : { color: muted }}>
                Formula
              </button>
              <button type="button" onClick={() => setMode('direct')}
                className="px-3 py-1.5 transition-all"
                style={mode === 'direct' ? { backgroundColor: '#e02020', color: '#fff' } : { color: muted }}>
                Direct
              </button>
            </div>
          </div>

          <form onSubmit={submitRound}>
            <div className="space-y-3 mb-5">
              {players.map(p => {
                const c = PLAYER_COLORS[playerColorIndex[p.id]];
                return (
                  <div key={p.id} className="flex items-center gap-3">
                    {/* Card chip */}
                    <div className="rounded-md font-black text-xs flex items-center justify-center flex-shrink-0"
                      style={{ width: 26, height: 34, backgroundColor: c.bg, color: c.text }}>
                      {players.indexOf(p) + 1}
                    </div>
                    <span className="w-24 text-sm font-bold truncate">{p.name}</span>

                    {mode === 'formula' ? (
                      <div className="flex items-end gap-2 flex-1">
                        <div className="flex-1">
                          <label className="text-xs font-medium block mb-1" style={{ color: muted }}>Played</label>
                          <input type="number" min="0" style={inputStyle}
                            value={formulaInputs[p.id]?.cards_played ?? ''}
                            onChange={e => setFormulaInputs(prev => ({ ...prev, [p.id]: { ...prev[p.id], cards_played: e.target.value } }))}
                            required />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs font-medium block mb-1" style={{ color: muted }}>In hand</label>
                          <input type="number" min="0" style={inputStyle}
                            value={formulaInputs[p.id]?.cards_in_hand ?? ''}
                            onChange={e => setFormulaInputs(prev => ({ ...prev, [p.id]: { ...prev[p.id], cards_in_hand: e.target.value } }))}
                            required />
                        </div>
                        <div className="w-12 text-right pb-1">
                          <span className="font-black font-mono text-base">
                            {formulaInputs[p.id]?.cards_played !== '' && formulaInputs[p.id]?.cards_in_hand !== ''
                              ? (() => {
                                  const s = parseInt(formulaInputs[p.id].cards_played) - parseInt(formulaInputs[p.id].cards_in_hand) * 2;
                                  return <span style={{ color: scoreColor(s) }}>{fmtScore(s)}</span>;
                                })()
                              : <span style={{ color: border }}>—</span>}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1">
                        <label className="text-xs font-medium block mb-1" style={{ color: muted }}>Score</label>
                        <input type="number" style={inputStyle}
                          value={directInputs[p.id] ?? ''}
                          onChange={e => setDirectInputs(prev => ({ ...prev, [p.id]: e.target.value }))}
                          required />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {error && <p className="text-sm mb-3" style={{ color: '#f87171' }}>{error}</p>}
            <button type="submit"
              className="w-full py-3 rounded-xl font-black uppercase tracking-widest text-sm"
              style={{ backgroundColor: '#e02020', color: '#fff' }}>
              Save Round
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
