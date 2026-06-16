// [V7-FIX] Reusable emoji picker for token logos
// Visual only — does not affect on-chain contract
const TOKEN_EMOJIS = [
  '🚀', '💎', '🔥', '⚡', '🌟', '🎯', '💰', '🪙',
  '🎮', '🎨', '🌐', '🎪', '🎭', '🎵', '🦄', '🐙',
  '🌙', '☀️', '🍕', '⚽', '🎁', '🏆', '🌈', '🔮',
  '💎', '🌊', '🌳', '🍀', '🌸', '🎯', '💎', '⚓',
];

interface TokenEmojiPickerProps {
  value: string;
  onChange: (emoji: string) => void;
}

export default function TokenEmojiPicker({ value, onChange }: TokenEmojiPickerProps) {
  return (
    <div>
      <label className="text-xs text-[var(--app-muted)]">Token Logo (Emoji)</label>
      <div className="grid grid-cols-8 sm:grid-cols-10 gap-2 mt-2">
        {TOKEN_EMOJIS.map((emoji, i) => (
          <button
            key={`${emoji}-${i}`}
            type="button"
            onClick={() => onChange(emoji)}
            className={`text-2xl p-2 rounded-xl border-2 transition-colors ${
              value === emoji
                ? 'border-[var(--app-blue)] bg-[var(--app-blue)]/10'
                : 'border-[var(--app-border)] hover:border-[var(--app-muted)]'
            }`}
            title={`Select ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-[var(--app-muted-2)] mt-2">
        Visual only — stored off-chain with your metadata.
      </p>
    </div>
  );
}
