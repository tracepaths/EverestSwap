// [V8] Token trust badge — displays 1-5 stars based on rating

interface TokenTrustBadgeProps {
  rating: number;  // 1-5
  label?: string;
  size?: 'sm' | 'md';
}

const FILLED = '\u2605';  // ★
const EMPTY = '\u2606';   // ☆

function getStars(rating: number): string {
  const clamped = Math.max(1, Math.min(5, rating));
  return FILLED.repeat(clamped) + EMPTY.repeat(5 - clamped);
}

const RATING_COLORS: Record<number, string> = {
  1: 'text-[var(--app-muted-2)]',
  2: 'text-[var(--app-muted-2)]',
  3: 'text-[var(--app-warning)]',
  4: 'text-[var(--app-warning)]',
  5: 'text-[var(--app-warning)]',
};

const RATING_LABELS: Record<number, string> = {
  1: 'Unverified',
  2: 'Low',
  3: 'Medium',
  4: 'High',
  5: 'Trusted',
};

function TokenTrustBadge({ rating, label, size = 'sm' }: TokenTrustBadgeProps) {
  const clamped = Math.max(1, Math.min(5, rating));
  const stars = getStars(clamped);
  const colorClass = RATING_COLORS[clamped];
  const displayLabel = label || RATING_LABELS[clamped];
  const fontSize = size === 'sm' ? 'text-[10px]' : 'text-xs';

  return (
    <span className={`inline-flex items-center gap-1 font-medium ${colorClass} ${fontSize}`} title={displayLabel}>
      <span>{stars}</span>
      {size === 'md' && (
        <span className="text-[var(--app-muted)]">{displayLabel}</span>
      )}
    </span>
  );
}

export default TokenTrustBadge;
