import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useFeedback } from '../feedback';
import type { Game, Group, Player } from '../types';
import { muted } from '../theme';
import { parseImportedGame } from '../lib/importParser';

interface Props {
  canEdit: boolean;
  onOpenGame: (id: number) => void;
}

function playerNamesOf(game: Game) {
  return (game.player_names ?? '').split(', ').filter(Boolean);
}

export default function NewGamePage({ canEdit, onOpenGame }: Props) {
  const { toast } = useFeedback();
  const [players, setPlayers] = useState<Player[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selectedPlayers, setSelectedPlayers] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);

  const load = useCallback(() => {
    const requests: [Promise<Player[]>, Promise<Game[]>, Promise<Group[]>] = [
      api.players.list(),
      api.games.list(),
      canEdit ? api.groups.list() : Promise.resolve([]),
    ];
    Promise.all(requests)
      .then(([playerList, gameList, groupList]) => {
        setPlayers(playerList);
        setGames(gameList);
        setGroups(groupList);
        setGroupId(prev => prev ?? groupList[0]?.id ?? null);
        setLoadError('');
      })
      .catch(err => setLoadError((err as Error).message))
      .finally(() => setLoaded(true));
  }, [canEdit]);

  useEffect(() => { load(); }, [load]);

  // Admins see every group; they pick one so a game never mixes groups. Players are already scoped.
  const pickingGroup = canEdit && groups.length > 1;
  const visiblePlayers = canEdit && groupId !== null ? players.filter(p => p.group_id === groupId) : players;
  const selected = selectedPlayers.filter(id => visiblePlayers.some(p => p.id === id));

  const changeGroup = (id: number) => {
    setGroupId(id);
    setSelectedPlayers([]);
    setError('');
  };

  const togglePlayer = (id: number) => {
    setSelectedPlayers(prev => (prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]));
  };

  const latestGame = games.find(g => (canEdit && groupId !== null ? g.group_id === groupId : true));
  const lastLineupIds = latestGame
    ? visiblePlayers.filter(p => playerNamesOf(latestGame).includes(p.name)).map(p => p.id)
    : [];
  const alreadySelected = lastLineupIds.length === selected.length && lastLineupIds.every(id => selected.includes(id));
  const canRepeatLineup = lastLineupIds.length >= 2 && !alreadySelected;

  const startGame = async () => {
    setError('');
    if (selected.length < 2) return setError('Select at least 2 players to start a game.');
    setStarting(true);
    try {
      const game = await api.games.create(selected);
      setSelectedPlayers([]);
      onOpenGame(game.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  // Live preview of what the pasted text will import.
  const importPreview = useMemo(() => {
    if (!importText.trim()) return null;
    try {
      return { ok: true as const, parsed: parseImportedGame(importText) };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  }, [importText]);

  const importGame = async () => {
    if (!importPreview?.ok) return;
    if (groupId === null) return toast('Choose a group for the imported game first.', 'error');
    const { parsed } = importPreview;
    setImporting(true);
    try {
      const game = await api.games.import(parsed.playerNames, parsed.rounds, groupId);
      setImportText('');
      toast(`Imported game #${game.id}`, 'success');
      onOpenGame(game.id);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setImporting(false);
    }
  };

  const groupName = groups.find(g => g.id === groupId)?.name;

  return (
    <div>
      <h2 className="text-2xl font-black uppercase tracking-wide mb-5">Start a new game</h2>

      {loadError && (
        <div role="alert" className="rounded-xl px-4 py-3 mb-4 text-sm flex items-center justify-between gap-3"
          style={{ backgroundColor: '#2a1010', color: '#fca5a5' }}>
          <span>Could not load players: {loadError}</span>
          <button type="button" onClick={load} className="font-black uppercase text-xs underline underline-offset-4">Retry</button>
        </div>
      )}

      <div className="grid gap-4">
        <div className="surface rounded-3xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <p className="text-xs font-black uppercase tracking-widest" style={{ color: muted }}>Who's playing?</p>
            {canRepeatLineup && (
              <button type="button" onClick={() => setSelectedPlayers(lastLineupIds)}
                className="text-xs font-bold underline underline-offset-4 text-white">
                Repeat last lineup
              </button>
            )}
          </div>

          {pickingGroup && (
            <div role="group" aria-label="Group" className="flex flex-wrap gap-2 mb-4">
              {groups.map(g => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => changeGroup(g.id)}
                  aria-pressed={groupId === g.id}
                  className="pill transition-colors"
                  style={groupId === g.id ? { borderColor: 'var(--red-bright)', color: '#fff' } : { color: muted }}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}

          {!loaded ? (
            <p className="text-sm" style={{ color: muted }}>Loading players…</p>
          ) : visiblePlayers.length < 2 ? (
            <p className="text-sm" style={{ color: muted }}>
              {groupName ? `The ${groupName} group needs` : 'You need'} at least 2 players.
              {canEdit ? ' Add them under Manage players.' : ' Ask your admin to add them.'}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-6" role="group" aria-label="Players in this game">
                {visiblePlayers.map((p, i) => {
                  const sel = selected.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePlayer(p.id)}
                      aria-pressed={sel}
                      className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all anim-fade-up"
                      style={{
                        ...(sel
                          ? { backgroundColor: 'var(--red)', color: '#fff', border: '1px solid var(--red-bright)', boxShadow: '0 6px 18px rgba(224,32,32,.35)' }
                          : { backgroundColor: 'var(--bg-2)', color: '#fff', border: '1px solid var(--border)' }),
                        ...({ '--delay': `${Math.min(i, 12) * 30}ms` } as React.CSSProperties),
                      }}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
              {error && <p className="text-sm mb-3" style={{ color: '#f87171' }} role="alert">{error}</p>}
              <div className="flex items-center gap-4">
                <button
                  onClick={startGame}
                  disabled={selected.length < 2 || starting}
                  className="btn-primary w-full sm:w-auto px-7 py-3 rounded-xl text-sm font-black uppercase tracking-widest"
                >
                  {starting ? 'Starting…' : `Start — ${selected.length} ${selected.length === 1 ? 'player' : 'players'}`}
                </button>
                {selected.length > 0 && (
                  <button type="button" onClick={() => setSelectedPlayers([])} className="text-xs font-bold" style={{ color: muted }}>
                    Clear
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {canEdit && (
          <div className="surface rounded-3xl p-5 sm:p-6">
            <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color: muted }}>Import a finished game</p>
            <p className="text-sm mb-4" style={{ color: muted }}>
              Paste names in the first row and one row of scores per round. Tabs, commas or semicolons all work.
              Unknown players are added to {groupName ? <strong className="text-white">{groupName}</strong> : 'the chosen group'}.
            </p>
            <label htmlFor="import-text" className="sr-only">Scores to import</label>
            <textarea
              id="import-text"
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder={'sam\tamber\tsofie\n14\t25\t10\n11\t11\t16'}
              spellCheck={false}
              className="field w-full text-sm font-mono resize-y min-h-40 mb-3"
            />
            {importPreview && (
              importPreview.ok ? (
                <p className="text-xs mb-3 font-bold" style={{ color: '#4ade80' }} role="status">
                  Ready: {importPreview.parsed.playerNames.length} players, {importPreview.parsed.rounds.length} rounds
                  <span className="font-normal" style={{ color: muted }}> ({importPreview.parsed.delimiterLabel}-separated)</span>
                </p>
              ) : (
                <p className="text-xs mb-3" style={{ color: '#f87171' }} role="alert">{importPreview.message}</p>
              )
            )}
            <div className="flex items-center gap-4">
              <button
                onClick={importGame}
                disabled={!importPreview?.ok || importing}
                className="btn-primary w-full sm:w-auto px-7 py-3 rounded-xl text-sm font-black uppercase tracking-widest"
              >
                {importing ? 'Importing…' : 'Import game'}
              </button>
              {importText && (
                <button type="button" onClick={() => setImportText('')} className="text-xs font-bold" style={{ color: muted }}>
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
