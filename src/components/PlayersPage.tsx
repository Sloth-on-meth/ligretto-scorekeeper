import { useState, useEffect } from 'react';
import { api } from '../api';
import type { Player } from '../types';

const card = { backgroundColor: '#0f2e20', border: '1px solid #1f5038', borderRadius: '12px' };
const mutedText = { color: '#6b9e7e' };

const SUITS = ['♠', '♥', '♦', '♣'];

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
      <h2 className="text-2xl font-black tracking-wide mb-6" style={{ color: '#f8f4ec' }}>
        ♥ Players
      </h2>

      <form onSubmit={add} className="flex gap-2 mb-6">
        <input
          className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
          style={{ backgroundColor: '#0f2e20', border: '1px solid #1f5038', color: '#f8f4ec' }}
          placeholder="Enter player name..."
          value={name}
          onChange={e => setName(e.target.value)}
          required
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-lg text-sm font-bold tracking-wide"
          style={{ backgroundColor: '#dc2626', color: '#f8f4ec' }}
        >
          Add
        </button>
      </form>

      {error && <p className="text-sm mb-4" style={{ color: '#f87171' }}>{error}</p>}

      <ul className="space-y-2">
        {players.map((p, i) => (
          <li key={p.id} style={card} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <span style={{ color: i % 2 === 0 ? '#6b9e7e' : '#f87171', fontSize: '1.1rem' }}>
                {SUITS[i % 4]}
              </span>
              <span className="font-semibold">{p.name}</span>
            </div>
            <button
              onClick={() => remove(p.id)}
              className="text-sm transition-colors"
              style={mutedText}
              onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
              onMouseLeave={e => (e.currentTarget.style.color = '#6b9e7e')}
            >
              Remove
            </button>
          </li>
        ))}
        {players.length === 0 && (
          <div className="text-center py-12" style={mutedText}>
            <div className="text-4xl mb-3">♥</div>
            <p className="text-sm">No players yet. Add one above.</p>
          </div>
        )}
      </ul>
    </div>
  );
}
