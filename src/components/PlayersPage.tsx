import { useState, useEffect } from 'react';
import { api } from '../api';
import type { Player } from '../types';

export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const load = () => api.players.list().then(setPlayers);
  useEffect(() => { load(); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.players.create(name);
      setName('');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (id: number) => {
    await api.players.delete(id);
    load();
  };

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-2xl font-bold mb-6">Players</h2>

      <form onSubmit={add} className="flex gap-2 mb-6">
        <input
          className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          placeholder="Player name"
          value={name}
          onChange={e => setName(e.target.value)}
          required
        />
        <button
          type="submit"
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          Add
        </button>
      </form>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      <ul className="space-y-2">
        {players.map(p => (
          <li key={p.id} className="flex items-center justify-between bg-slate-800 rounded-lg px-4 py-3">
            <span className="font-medium">{p.name}</span>
            <button
              onClick={() => remove(p.id)}
              className="text-slate-400 hover:text-red-400 text-sm transition-colors"
            >
              Remove
            </button>
          </li>
        ))}
        {players.length === 0 && (
          <p className="text-slate-400 text-sm text-center py-8">No players yet. Add one above.</p>
        )}
      </ul>
    </div>
  );
}
