interface TokenTrustBadgeProps {
  isTrusted: boolean;
}

function TokenTrustBadge({ isTrusted }: TokenTrustBadgeProps) {
  if (isTrusted) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--app-warning)]">
        <span>&#9733;&#9733;&#9733;&#9733;&#9733;</span>
        <span className="text-[var(--app-muted)]">Trusted</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--app-muted)]">
      <span className="text-[var(--app-warning)]">&#9733;</span>
      <span>&#9734;&#9734;&#9734;&#9734;</span>
      <span className="text-[var(--app-muted-2)]">Custom Token</span>
    </span>
  );
}

export default TokenTrustBadge;
