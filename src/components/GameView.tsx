import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useFeedback } from '../feedback';
import type { GameDetail, RoundScore } from '../types';
import { PLAYER_COLORS, surface, border, muted } from '../theme';

interface Props {
  gameId: number;
  onBack: () => void;
  canEdit: boolean;
}

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

const scoreColor = (s: number) => (s >= 0 ? '#4ade80' : '#f87171');
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

export default function GameView({ gameId, onBack, canEdit }: Props) {
  const { toast, confirm } = useFeedback();
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [loadError, setLoadError] = useState('');
  const [directInputs, setDirectInputs] = useState<Record<number, string>>({});
  const [editingRound, setEditingRound] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const formRef = useRef<HTMLFormElement>(null);

  const load = useCallback(() => api.games.get(gameId)
    .then(d => {
      setDetail(d);
      setLoadError('');
      const di: Record<number, string> = {};
      d.players.forEach(p => { di[p.id] = ''; });
      setDirectInputs(di);
      setEditingRound(null);
    })
    .catch(err => setLoadError((err as Error).message)), [gameId]);

  useEffect(() => { load(); }, [load]);

  if (!detail) {
    return loadError ? (
      <div>
        <button onClick={onBack} className="text-sm font-bold mb-5" style={{ color: muted }}>← All games</button>
        <p className="text-sm" style={{ color: '#f87171' }} role="alert">Could not load this game: {loadError}</p>
      </div>
    ) : (
      <p style={{ color: muted }}>Loading…</p>
    );
  }

  const { game, players, rounds } = detail;
  const isFinished = Boolean(game.finished_at);
  const canChange = canEdit && !isFinished;

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
  const topTotal = players.length > 0 ? Math.max(...players.map(p => totals[p.id] ?? 0)) : 0;
  // Everyone on the top total wins, so ties share the trophy.
  const winners = isFinished && rounds.length > 0
    ? sortedPlayers.filter(p => (totals[p.id] ?? 0) === topTotal)
    : [];
  const isWinner = (playerId: number) => winners.some(w => w.id === playerId);
  const playerColorIndex: Record<number, number> = {};
  players.forEach((p, i) => { playerColorIndex[p.id] = i % PLAYER_COLORS.length; });
  // Next round number matches what the server assigns (max + 1), even after deletions.
  const nextRoundNumber = roundNumbers.length > 0 ? roundNumbers[roundNumbers.length - 1] + 1 : 1;
  const leaderNames = sortedPlayers.length > 1 && !isFinished && rounds.length > 0
    && (totals[sortedPlayers[0].id] ?? 0) > (totals[sortedPlayers[1].id] ?? 0)
    ? sortedPlayers[0].name
    : null;

  const startEditing = (roundNumber: number) => {
    const roundRows = scoreMap[roundNumber] ?? {};
    const di: Record<number, string> = {};
    players.forEach(p => {
      const row = roundRows[p.id];
      di[p.id] = row ? String(row.score) : '';
    });
    setDirectInputs(di);
    setEditingRound(roundNumber);
    setError('');
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  const cancelEditing = () => {
    setEditingRound(null);
    load();
  };

  const focusFirstField = () => {
    formRef.current?.querySelector<HTMLInputElement>('input')?.focus();
  };

  // Enter moves to the next field; on the last field it submits the round.
  const onEntryKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
    const fields = Array.from(e.currentTarget.querySelectorAll<HTMLInputElement>('input[data-entry]'));
    const index = fields.indexOf(e.target);
    if (index >= 0 && index < fields.length - 1) {
      e.preventDefault();
      fields[index + 1].focus();
      fields[index + 1].select();
    }
  };

  const submitRound = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError('');
    const scores = players.map(p => ({ player_id: p.id, score: parseInt(directInputs[p.id] ?? '', 10) }));
    if (scores.some(sc => isNaN(sc.score))) return setError('Enter a score for every player');

    setSaving(true);
    try {
      if (editingRound !== null) {
        await api.rounds.update(gameId, roundIdMap[editingRound], scores);
        toast(`Round ${editingRound} updated`, 'success');
      } else {
        await api.rounds.add(gameId, scores);
        toast(`Round ${nextRoundNumber} saved`, 'success');
      }
      await load();
      requestAnimationFrame(focusFirstField);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const deleteRound = async (roundNumber: number) => {
    const ok = await confirm({
      title: `Delete round ${roundNumber}?`,
      message: 'Its scores are removed from this game and from the stats.',
      confirmLabel: 'Delete round',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.rounds.delete(gameId, roundIdMap[roundNumber]);
      toast(`Round ${roundNumber} deleted`);
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const finishGame = async () => {
    const ok = await confirm({
      title: 'Finish this game?',
      message: 'A finished game is locked: rounds can no longer be added, edited or removed.',
      confirmLabel: 'Finish game',
    });
    if (!ok) return;
    try {
      await api.games.finish(gameId);
      toast('Game finished', 'success');
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div className="min-w-0">
          <h2 className="text-2xl font-black uppercase tracking-wide">Game #{game.id}</h2>
          <p className="text-xs mt-0.5" style={{ color: muted }}>
            {new Date(game.started_at).toLocaleString()} · {roundNumbers.length} {roundNumbers.length === 1 ? 'round' : 'rounds'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {roundNumbers.length > 0 && (
            <button
              onClick={() => exportCSV(detail)}
              aria-label="Export game as CSV"
              className="px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wide"
              style={{ backgroundColor: surface, border: `1px solid ${border}`, color: muted }}
              onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
              onMouseLeave={e => (e.currentTarget.style.color = muted)}
            >
              CSV ↓
            </button>
          )}
          {canChange ? (
            <button onClick={finishGame}
              className="px-4 py-2 rounded-xl text-sm font-black uppercase tracking-wide"
              style={{ backgroundColor: '#15502a', color: '#4ade80', border: '1px solid #1a6634' }}>
              Finish ✓
            </button>
          ) : isFinished ? (
            <span className="px-3 py-1.5 rounded-xl text-xs font-black uppercase"
              style={{ backgroundColor: '#15502a', color: '#4ade80' }}>
              Finished
            </span>
          ) : (
            <span className="px-3 py-1.5 rounded-xl text-xs font-black uppercase"
              style={{ backgroundColor: '#2a2a38', color: muted }}>
              Read-only
            </span>
          )}
        </div>
      </div>

      {/* Result banner */}
      {winners.length > 0 && (
        <div className="rounded-2xl px-4 py-3 mb-6 flex items-center gap-3 font-black uppercase tracking-wide"
          style={{ backgroundColor: '#e02020', color: '#fff' }} role="status">
          <span aria-hidden="true" className="text-xl">🏆</span>
          <span>{winners.length === 1 ? `${winners[0].name} wins` : `Tie: ${winners.map(w => w.name).join(' & ')}`}</span>
          <span className="ml-auto font-mono text-base">{topTotal}</span>
        </div>
      )}

      {/* Scoreboard — rounds as rows, players as columns. Scrolls sideways on small screens. */}
      {roundNumbers.length > 0 && (
        <div className="rounded-2xl overflow-hidden mb-8" style={{ border: `1px solid ${border}` }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 120 + sortedPlayers.length * 84 }}>
              <thead>
                <tr style={{ backgroundColor: surface }}>
                  <th className="sticky left-0 z-[1] text-left py-3 px-4 text-xs font-black uppercase tracking-widest"
                    style={{ color: muted, backgroundColor: surface, width: 64 }}>
                    Round
                  </th>
                  {sortedPlayers.map((p, rank) => {
                    const c = PLAYER_COLORS[playerColorIndex[p.id]];
                    return (
                      <th key={p.id} className="text-center py-3 px-2">
                        <div className="flex flex-col items-center gap-1">
                          <div className="rounded-md font-black text-xs flex items-center justify-center"
                            style={{ width: 26, height: 34, backgroundColor: c.bg, color: c.text, boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }}
                            aria-hidden="true">
                            {isWinner(p.id) ? '🏆' : rank + 1}
                          </div>
                          <span className="font-bold text-xs max-w-[80px] truncate">{p.name}</span>
                        </div>
                      </th>
                    );
                  })}
                  {canChange && <th style={{ width: 32 }} />}
                </tr>
              </thead>
              <tbody>
                {roundNumbers.map(r => {
                  const isEditingThis = editingRound === r;
                  return (
                    <tr key={r} style={{
                      borderTop: `1px solid ${border}`,
                      backgroundColor: isEditingThis ? '#2a1010' : undefined,
                    }}>
                      <td className="sticky left-0 z-[1] py-2.5 px-4" style={{ backgroundColor: isEditingThis ? '#2a1010' : '#111118' }}>
                        {canChange ? (
                          <button
                            onClick={() => startEditing(r)}
                            aria-label={`Edit round ${r}`}
                            title="Edit round"
                            className="font-black text-xs uppercase tracking-wide underline decoration-dotted underline-offset-4 hover:text-white"
                            style={{ color: muted }}
                          >
                            R{r}
                          </button>
                        ) : (
                          <span className="font-black text-xs uppercase tracking-wide" style={{ color: muted }}>R{r}</span>
                        )}
                      </td>
                      {sortedPlayers.map(p => {
                        const s = scoreMap[r]?.[p.id];
                        return (
                          <td key={p.id} className="py-2.5 px-2 text-center font-mono font-bold text-sm">
                            {s ? (
                              <span style={{ color: scoreColor(s.score) }}>
                                {fmtScore(s.score)}
                              </span>
                            ) : <span style={{ color: border }}>—</span>}
                          </td>
                        );
                      })}
                      {canChange && (
                        <td className="py-2.5 pr-3 text-center">
                          <button onClick={() => deleteRound(r)}
                            className="text-xs transition-colors px-1"
                            style={{ color: muted }}
                            aria-label={`Delete round ${r}`}
                            title="Delete round"
                            onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                            onMouseLeave={e => (e.currentTarget.style.color = muted)}>
                            ✕
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {/* Totals row */}
                <tr style={{ borderTop: `2px solid ${border}`, backgroundColor: surface }}>
                  <td className="sticky left-0 z-[1] py-3 px-4 font-black text-xs uppercase tracking-wide"
                    style={{ color: muted, backgroundColor: surface }}>
                    Total
                  </td>
                  {sortedPlayers.map(p => {
                    const c = PLAYER_COLORS[playerColorIndex[p.id]];
                    return (
                      <td key={p.id} className="py-3 px-2 text-center font-black text-base"
                        style={{ color: c.bg === '#c89800' ? '#d4a500' : c.bg }}>
                        {totals[p.id] ?? 0}
                      </td>
                    );
                  })}
                  {canChange && <td />}
                </tr>
              </tbody>
            </table>
          </div>
          {leaderNames && (
            <p className="text-xs px-4 py-2" style={{ color: muted, borderTop: `1px solid ${border}` }}>
              {leaderNames} leads by {(totals[sortedPlayers[0].id] ?? 0) - (totals[sortedPlayers[1].id] ?? 0)}
            </p>
          )}
        </div>
      )}

      {/* Round entry */}
      {!canEdit && !isFinished && (
        <div className="rounded-2xl p-4" style={{ backgroundColor: surface, border: `1px solid ${border}`, color: muted }}>
          Sign in to add rounds, edit rounds, or finish this game.
        </div>
      )}
      {canChange && (
        <div className="rounded-2xl p-4" style={{
          backgroundColor: surface,
          border: `1px solid ${editingRound !== null ? '#e02020' : border}`,
        }}>
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            {editingRound !== null ? (
              <div className="flex items-center gap-3">
                <p className="text-xs font-black uppercase tracking-widest" style={{ color: '#f87171' }}>
                  Editing round {editingRound}
                </p>
                <button type="button" onClick={cancelEditing}
                  className="text-xs font-bold underline underline-offset-4" style={{ color: muted }}>
                  Cancel
                </button>
              </div>
            ) : (
              <p className="text-xs font-black uppercase tracking-widest" style={{ color: muted }}>
                Round {nextRoundNumber}
              </p>
            )}
          </div>

          <form ref={formRef} onSubmit={submitRound} onKeyDown={onEntryKeyDown}>
            <p className="mb-3 text-xs" style={{ color: muted }}>
              Type each player’s score for this round. Press Enter to move to the next player.
            </p>
            <div className="mb-4" style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
              gap: '8px',
              alignItems: 'center',
            }}>
              <div className="text-xs font-black uppercase tracking-wide" style={{ color: muted }}>Player</div>
              <div className="text-xs font-black uppercase tracking-wide text-center" style={{ color: muted }}>Score</div>

              {players.map((p, index) => {
                const c = PLAYER_COLORS[playerColorIndex[p.id]];
                return (
                  <React.Fragment key={p.id}>
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="rounded-md font-black flex items-center justify-center flex-shrink-0"
                        style={{ width: 28, height: 36, backgroundColor: c.bg, color: c.text, fontSize: '0.7rem' }}
                        aria-hidden="true">
                        {index + 1}
                      </div>
                      <span className="font-bold text-sm truncate">{p.name}</span>
                    </div>
                    <input type="number" inputMode="numeric" placeholder="0" data-entry
                      aria-label={`${p.name} score`}
                      style={inputStyle}
                      value={directInputs[p.id] ?? ''}
                      onChange={e => setDirectInputs(prev => ({ ...prev, [p.id]: e.target.value }))}
                      required />
                  </React.Fragment>
                );
              })}
            </div>

            {error && <p className="text-sm mb-3" style={{ color: '#f87171' }} role="alert">{error}</p>}
            <button type="submit" disabled={saving}
              className="w-full py-4 rounded-xl font-black uppercase tracking-widest text-base transition-opacity disabled:opacity-60"
              style={{ backgroundColor: '#e02020', color: '#fff' }}>
              {saving ? 'Saving…' : editingRound !== null ? `Update round ${editingRound}` : 'Save round'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
