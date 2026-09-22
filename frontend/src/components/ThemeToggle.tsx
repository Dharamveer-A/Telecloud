import { useTheme } from "../lib/theme";

interface Props {
  compact?: boolean;
  className?: string;
}

export default function ThemeToggle({ compact, className = "" }: Props) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      title={isDark ? "Switch to Light mode" : "Switch to Dark mode"}
      aria-label={isDark ? "Switch to Light mode" : "Switch to Dark mode"}
      className={`rounded-lg transition-all flex items-center justify-center cursor-pointer select-none ${
        compact
          ? "w-8 h-8 bg-surface hover:bg-surface2 text-paper border border-line shadow-sm"
          : "w-full px-2.5 py-1.5 text-xs text-dim hover:text-paper bg-surface hover:bg-surface2 rounded gap-2 border border-line"
      } ${className}`}
    >
      <span className="text-sm leading-none" role="img" aria-hidden="true">
        {isDark ? "☀️" : "🌙"}
      </span>
      {!compact && (
        <span className="font-medium">
          {isDark ? "Light mode" : "Dark mode"}
        </span>
      )}
    </button>
  );
}
