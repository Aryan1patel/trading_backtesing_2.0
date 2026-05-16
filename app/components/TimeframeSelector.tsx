"use client";

import { TIMEFRAMES, Timeframe } from "@/lib/dataService";

interface TimeframeSelectorProps {
  active: Timeframe;
  onChange: (tf: Timeframe) => void;
  isLoading?: boolean;
  /** When true, all buttons are disabled (e.g. during replay mode) */
  disabled?: boolean;
}

export default function TimeframeSelector({
  active,
  onChange,
  isLoading = false,
  disabled = false,
}: TimeframeSelectorProps) {
  return (
    <div
      className={`timeframe-selector${disabled ? " tf-selector--disabled" : ""}`}
      role="group"
      aria-label="Timeframe selector"
      aria-disabled={disabled}
    >
      {TIMEFRAMES.map(({ key, label }) => (
        <button
          key={key}
          id={`tf-btn-${key}`}
          className={`tf-btn${active === key ? " active" : ""}${isLoading && active === key ? " loading" : ""}`}
          onClick={() => onChange(key)}
          aria-pressed={active === key}
          aria-label={`${label} timeframe`}
          disabled={isLoading || disabled}
          title={disabled ? "Timeframe switching disabled during replay" : undefined}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
