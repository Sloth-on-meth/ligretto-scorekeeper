import { useState } from 'react';
import { api } from '../api';
import type { AuthSession } from '../types';
import { muted } from '../theme';
import CardFan from './CardFan';

interface Props {
  onSignedIn: (session: AuthSession) => void;
}

export default function SignInPage({ onSignedIn }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shaking, setShaking] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const session = await api.auth.login(password);
      setPassword('');
      onSignedIn(session);
    } catch (err) {
      setError((err as Error).message);
      setShaking(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm anim-fade-up">
        <div className="flex flex-col items-center mb-8">
          <CardFan size={44} animate className="mb-5 anim-float" />
          <h1 className="font-black text-3xl tracking-[.25em] uppercase" style={{ color: 'var(--red-bright)' }}>
            Ligretto
          </h1>
          <p className="text-xs tracking-[.3em] uppercase mt-1" style={{ color: muted }}>Scorekeeper</p>
        </div>

        <form
          onSubmit={submit}
          onAnimationEnd={() => setShaking(false)}
          className={`surface rounded-3xl p-6 ${shaking ? 'anim-shake' : ''}`}
        >
          <label htmlFor="password" className="block text-xs font-black uppercase tracking-widest mb-2" style={{ color: muted }}>
            Group password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={e => { setPassword(e.target.value); if (error) setError(''); }}
            placeholder="••••••••"
            className="field w-full mb-3"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'password-error' : undefined}
          />
          {error && (
            <p id="password-error" role="alert" className="text-sm mb-3" style={{ color: '#f87171' }}>{error}</p>
          )}
          <button
            type="submit"
            disabled={busy || !password}
            className="btn-primary w-full py-3.5 rounded-xl font-black uppercase tracking-widest"
          >
            {busy ? 'Signing in…' : 'Enter'}
          </button>
          <p className="text-xs mt-4 text-center" style={{ color: muted }}>
            Ask your group for the password. Admins use the admin password.
          </p>
        </form>
      </div>
    </div>
  );
}
