import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AuthSession, Game } from '../types';
import type { View } from '../navigation';
import { muted } from '../theme';
import CardFan from './CardFan';

interface Props {
  auth: AuthSession;
  onNavigate: (view: View) => void;
  onLogout: () => void;
}

interface ActionProps {
  title: string;
  description: string;
  accent: string;
  icon: React.ReactNode;
  delay: number;
  onClick: () => void;
}

function ActionCard({ title, description, accent, icon, delay, onClick }: ActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="action-card surface card-lift rounded-3xl p-6 text-left w-full anim-fade-up"
      style={{ '--delay': `${delay}ms`, '--accent': accent } as React.CSSProperties}
    >
      <span className="action-icon" aria-hidden="true">{icon}</span>
      <span className="block font-black text-xl mt-5 mb-1">{title}</span>
      <span className="block text-sm pr-8" style={{ color: muted }}>{description}</span>
      <span className="action-arrow" aria-hidden="true">→</span>
    </button>
  );
}

function PlusIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M5 20V10M12 20V4M19 20v-7" />
    </svg>
  );
}

export default function LandingPage({ auth, onNavigate, onLogout }: Props) {
  const [inProgress, setInProgress] = useState<Game | null>(null);

  // A shortcut back into a game that's still being played. Optional: the landing works without it.
  useEffect(() => {
    let cancelled = false;
    api.games.list()
      .then(games => { if (!cancelled) setInProgress(games.find(g => !g.finished_at) ?? null); })
      .catch(() => { /* no shortcut; the three main actions still work */ });
    return () => { cancelled = true; };
  }, []);

  const isAdmin = auth.role === 'admin';

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-16">
      <div className="flex items-center justify-between mb-10 anim-fade-up">
        <span className="pill">{isAdmin ? 'Admin' : `Group · ${auth.group?.name ?? 'player'}`}</span>
        <button type="button" onClick={onLogout} className="btn-ghost text-xs">Log out</button>
      </div>

      <div className="flex flex-col items-center text-center mb-10">
        <CardFan size={56} animate className="mb-6 anim-float" />
        <h1
          className="font-black text-4xl sm:text-5xl tracking-[.2em] uppercase anim-fade-up"
          style={{ color: 'var(--red-bright)', '--delay': '120ms' } as React.CSSProperties}
        >
          Ligretto
        </h1>
        <p
          className="text-xs sm:text-sm tracking-[.35em] uppercase mt-2 anim-fade-up"
          style={{ color: muted, '--delay': '180ms' } as React.CSSProperties}
        >
          Scorekeeper
        </p>
      </div>

      {inProgress && (
        <div className="flex justify-center mb-8 anim-fade-up" style={{ '--delay': '240ms' } as React.CSSProperties}>
          <button
            type="button"
            onClick={() => onNavigate({ kind: 'game', id: inProgress.id, from: 'home' })}
            className="resume-pill"
          >
            <span className="pulse-dot" aria-hidden="true" />
            <span className="whitespace-nowrap">Resume game #{inProgress.id}</span>
            <span className="truncate opacity-70 text-sm font-semibold">· {inProgress.player_names}</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <ActionCard
          delay={260}
          accent="var(--red-bright)"
          title="Start new game"
          description="Pick who's playing and keep score round by round."
          icon={<PlusIcon />}
          onClick={() => onNavigate({ kind: 'new' })}
        />
        <ActionCard
          delay={340}
          accent="var(--blue)"
          title="View previous games"
          description="Every game your group has played, with the winners."
          icon={<HistoryIcon />}
          onClick={() => onNavigate({ kind: 'games' })}
        />
        <ActionCard
          delay={420}
          accent="var(--green)"
          title="View statistics"
          description="Totals, wins and best rounds for everyone in the group."
          icon={<ChartIcon />}
          onClick={() => onNavigate({ kind: 'stats' })}
        />
      </div>

      {isAdmin && (
        <div className="mt-6 anim-fade-up" style={{ '--delay': '520ms' } as React.CSSProperties}>
          <button
            type="button"
            onClick={() => onNavigate({ kind: 'players' })}
            className="surface card-lift rounded-2xl px-5 py-4 w-full flex items-center justify-between gap-4 text-left"
          >
            <span className="min-w-0">
              <span className="block font-black">Manage players</span>
              <span className="block text-xs" style={{ color: muted }}>Add people, rename them, and put them in a group.</span>
            </span>
            <span aria-hidden="true" className="text-xl flex-shrink-0" style={{ color: muted }}>→</span>
          </button>
        </div>
      )}
    </div>
  );
}
