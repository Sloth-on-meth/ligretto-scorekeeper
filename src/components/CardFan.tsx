import { PLAYER_COLORS } from '../theme';

interface Props {
  /** Card width in px; height scales with it. */
  size?: number;
  /** Plays the fan-out entrance animation. */
  animate?: boolean;
  className?: string;
}

/** The four Ligretto card colours fanned out: the app's mark. */
export default function CardFan({ size = 22, animate = false, className = '' }: Props) {
  const height = Math.round(size * 1.36);
  const overlap = Math.round(size * 0.36);
  return (
    <div className={`flex ${className}`} aria-hidden="true" style={{ paddingLeft: overlap }}>
      {PLAYER_COLORS.map((c, i) => {
        const angle = `${(i - 1.5) * 7}deg`;
        const style = {
          width: size,
          height,
          backgroundColor: c.bg,
          marginLeft: -overlap,
          zIndex: i,
          fontSize: Math.max(10, Math.round(size * 0.5)),
          boxShadow: '0 2px 6px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.18)',
          transform: `rotate(${angle})`,
          // The fan animation starts from a stacked deck and settles at this angle.
          '--angle': angle,
          '--delay': `${i * 70}ms`,
        } as React.CSSProperties;
        return (
          <div
            key={c.label}
            className={`rounded-md flex items-center justify-center font-black text-white ${animate ? 'anim-fan' : ''}`}
            style={style}
          >
            {i + 1}
          </div>
        );
      })}
    </div>
  );
}
