import React, { useEffect, useState } from 'react';
import { api } from '../api';
import type { GameDetail, RoundScore } from '../types';
import { PLAYER_COLORS, surface, border, muted } from '../theme';

interface Props {
  gameId: number;
  onBack: () => void;
}

type InputMode = 'formula' | 'direct';

function csvCell(value: string | number) {
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportCSV(detail: GameDetail) {
  const { game, players, rounds } = detail;
  const roundNumbers = [...new Set(rounds.map(r => r.round_number))].sort((a, b) => a - b);
  const scoreMap: Record<number, Record<number, number>> = {};
  rounds.forEach(r => {
    if (!scoreMap[r.round_number]) scoreMap[r.round_number] = {};
    scoreMap[r.round_number][r.player_id] = r.score;
  });

  const header = ['Player', ...roundNumbers.map(r => `R${r}`), 'Total']
    .map(csvCell)
    .join(',');
  const rows = players.map(p => {
    const total = rounds.filter(r => r.player_id === p.id).reduce((s, r) => s + r.score, 0);
    const scores = roundNumbers.map(r => scoreMap[r]?.[p.id] ?? '');
    return [p.name, ...scores, total].map(csvCell).join(',');
  });

  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ligretto-game-${game.id}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

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
    borderRadius: 10,
    color: '#fff',
    width: '100%',
    padding: '12px 14px',
    fontSize: '1.1rem',
    fontWeight: 700,
    minHeight: 48,
    textAlign: 'center',
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
      <div className="flex items-start justify-between mb-6 gap-3">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-wide">Game #{game.id}</h2>
          <p className="text-xs mt-0.5" style={{ color: muted }}>
            {new Date(game.started_at).toLocaleString()} · {roundNumbers.length} rounds
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {roundNumbers.length > 0 && (
            <button
              onClick={() => exportCSV(detail)}
              className="px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wide"
              style={{ backgroundColor: surface, border: `1px solid ${border}`, color: muted }}
              onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
              onMouseLeave={e => (e.currentTarget.style.color = muted)}
            >
              CSV ↓
            </button>
          )}
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
      </div>

      {/* Scoreboard — rounds as rows, players as columns */}
      {roundNumbers.length > 0 && (
        <div className="rounded-2xl overflow-hidden mb-8" style={{ border: `1px solid ${border}` }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: '#1a1a24' }}>
                <th className="text-left py-3 px-4 text-xs font-black uppercase tracking-widest" style={{ color: muted, width: 64 }}>
                  Round
                </th>
                {sortedPlayers.map((p, rank) => {
                  const c = PLAYER_COLORS[playerColorIndex[p.id]];
                  return (
                    <th key={p.id} className="text-center py-3 px-3">
                      <div className="flex flex-col items-center gap-1">
                        <div className="rounded-md font-black text-xs flex items-center justify-center"
                          style={{ width: 26, height: 34, backgroundColor: c.bg, color: c.text, boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }}>
                          {game.finished_at && rank === 0 ? '🏆' : rank + 1}
                        </div>
                        <span className="font-bold text-xs">{p.name}</span>
                      </div>
                    </th>
                  );
                })}
                {!game.finished_at && <th style={{ width: 32 }} />}
              </tr>
            </thead>
            <tbody>
              {roundNumbers.map(r => (
                <tr key={r} style={{ borderTop: `1px solid ${border}` }}>
                  <td className="py-2.5 px-4 font-black text-xs uppercase tracking-wide" style={{ color: muted }}>
                    R{r}
                  </td>
                  {sortedPlayers.map(p => {
                    const s = scoreMap[r]?.[p.id];
                    return (
                      <td key={p.id} className="py-2.5 px-3 text-center font-mono font-bold text-sm">
                        {s ? (
                          <span style={{ color: scoreColor(s.score) }}
                            title={s.cards_played != null ? `Played: ${s.cards_played}, In hand: ${s.cards_in_hand}` : undefined}>
                            {fmtScore(s.score)}
                          </span>
                        ) : <span style={{ color: border }}>—</span>}
                      </td>
                    );
                  })}
                  {!game.finished_at && (
                    <td className="py-2.5 pr-3 text-center">
                      <button onClick={() => deleteRound(roundIdMap[r])}
                        className="text-xs transition-colors"
                        style={{ color: border }}
                        title="Delete round"
                        onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                        onMouseLeave={e => (e.currentTarget.style.color = border)}>
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {/* Totals row */}
              <tr style={{ borderTop: `2px solid ${border}`, backgroundColor: '#1a1a24' }}>
                <td className="py-3 px-4 font-black text-xs uppercase tracking-wide" style={{ color: muted }}>
                  Total
                </td>
                {sortedPlayers.map(p => {
                  const c = PLAYER_COLORS[playerColorIndex[p.id]];
                  return (
                    <td key={p.id} className="py-3 px-3 text-center font-black text-base"
                      style={{ color: c.bg === '#c89800' ? '#d4a500' : c.bg }}>
                      {totals[p.id] ?? 0}
                    </td>
                  );
                })}
                {!game.finished_at && <td />}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Round entry form — mobile-first card-per-player layout */}
      {!game.finished_at && (
        <div className="rounded-2xl p-4" style={{ backgroundColor: surface, border: `1px solid ${border}` }}>
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-black uppercase tracking-widest" style={{ color: muted }}>
              Round {roundNumbers.length + 1}
            </p>
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
            {/* Grid: [chip+name] [played] [in hand] [score]  — or  [chip+name] [score] in direct mode */}
            <div className="mb-4" style={{
              display: 'grid',
              gridTemplateColumns: mode === 'formula' ? '1fr 1fr 1fr 48px' : '1fr 1fr',
              gap: '8px',
              alignItems: 'center',
            }}>
              {/* Column headers */}
              <div className="text-xs font-black uppercase tracking-wide" style={{ color: muted }}>Player</div>
              {mode === 'formula' ? (
                <>
                  <div className="text-xs font-black uppercase tracking-wide text-center" style={{ color: muted }}>Played</div>
                  <div className="text-xs font-black uppercase tracking-wide text-center" style={{ color: muted }}>In hand</div>
                  <div className="text-xs font-black uppercase tracking-wide text-center" style={{ color: muted }}>Score</div>
                </>
              ) : (
                <div className="text-xs font-black uppercase tracking-wide text-center" style={{ color: muted }}>Score</div>
              )}

              {/* Player rows */}
              {players.map(p => {
                const c = PLAYER_COLORS[playerColorIndex[p.id]];
                const fi = formulaInputs[p.id];
                const previewScore = fi?.cards_played !== '' && fi?.cards_in_hand !== ''
                  ? parseInt(fi.cards_played) - parseInt(fi.cards_in_hand) * 2
                  : null;

                return (
                  <React.Fragment key={p.id}>
                    {/* Name cell */}
                    <div className="flex items-center gap-2">
                      <div className="rounded-md font-black flex items-center justify-center flex-shrink-0"
                        style={{ width: 28, height: 36, backgroundColor: c.bg, color: c.text, fontSize: '0.7rem' }}>
                        {players.indexOf(p) + 1}
                      </div>
                      <span className="font-bold text-sm truncate">{p.name}</span>
                    </div>

                    {mode === 'formula' ? (
                      <>
                        <input type="number" min="0" inputMode="numeric" placeholder="0"
                          style={inputStyle}
                          value={fi?.cards_played ?? ''}
                          onChange={e => setFormulaInputs(prev => ({ ...prev, [p.id]: { ...prev[p.id], cards_played: e.target.value } }))}
                          required />
                        <input type="number" min="0" inputMode="numeric" placeholder="0"
                          style={inputStyle}
                          value={fi?.cards_in_hand ?? ''}
                          onChange={e => setFormulaInputs(prev => ({ ...prev, [p.id]: { ...prev[p.id], cards_in_hand: e.target.value } }))}
                          required />
                        <div className="font-black font-mono text-base text-center">
                          {previewScore !== null && !isNaN(previewScore)
                            ? <span style={{ color: scoreColor(previewScore) }}>{fmtScore(previewScore)}</span>
                            : <span style={{ color: border }}>—</span>}
                        </div>
                      </>
                    ) : (
                      <input type="number" inputMode="numeric" placeholder="0"
                        style={inputStyle}
                        value={directInputs[p.id] ?? ''}
                        onChange={e => setDirectInputs(prev => ({ ...prev, [p.id]: e.target.value }))}
                        required />
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            {error && <p className="text-sm mb-3" style={{ color: '#f87171' }}>{error}</p>}
            <button type="submit"
              className="w-full py-4 rounded-xl font-black uppercase tracking-widest text-base"
              style={{ backgroundColor: '#e02020', color: '#fff' }}>
              Save Round
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
