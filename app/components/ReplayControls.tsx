"use client";

import { ReplayState, ReplaySpeed } from "@/lib/replayEngine";

interface ReplayControlsProps {
  state: ReplayState;
  onPlay: () => void;
  onPause: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onSpeedChange: (speed: ReplaySpeed) => void;
  onExit: () => void;
}

const SPEEDS: { key: ReplaySpeed; label: string }[] = [
  { key: "slow", label: "0.5×" },
  { key: "normal", label: "1×" },
  { key: "fast", label: "5×" },
];

export default function ReplayControls({
  state,
  onPlay,
  onPause,
  onStepBack,
  onStepForward,
  onSpeedChange,
  onExit,
}: ReplayControlsProps) {
  const { status, currentIndex, totalBars, speed } = state;

  // Don't render during picking or idle — handled by parent
  if (status === "idle" || status === "picking") return null;

  const isPlaying = status === "playing";
  const canBack = currentIndex > 1;
  const canForward = currentIndex < totalBars;
  const progress = totalBars > 0 ? (currentIndex / totalBars) * 100 : 0;

  return (
    <div className="replay-controls" role="toolbar" aria-label="Replay controls">

      {/* ── Transport ──────────────────────────────────────────────── */}
      <div className="replay-transport">
        <button
          id="replay-step-back"
          className="replay-ctrl-btn"
          onClick={onStepBack}
          disabled={!canBack}
          aria-label="Step back one candle"
          title="Step back"
        >
          {/* |◀ */}
          <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor" aria-hidden="true">
            <rect x="1" y="1.5" width="2" height="10" rx="1" />
            <path d="M11.5 1.5 L4 6.5 L11.5 11.5Z" />
          </svg>
        </button>

        <button
          id="replay-play-pause"
          className="replay-ctrl-btn replay-play-btn"
          onClick={isPlaying ? onPause : onPlay}
          disabled={!canForward && !isPlaying}
          aria-label={isPlaying ? "Pause replay" : "Play replay"}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            /* ⏸ */
            <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor" aria-hidden="true">
              <rect x="2" y="2" width="3.5" height="9" rx="1" />
              <rect x="7.5" y="2" width="3.5" height="9" rx="1" />
            </svg>
          ) : (
            /* ▶ */
            <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor" aria-hidden="true">
              <path d="M2.5 1.5 L11.5 6.5 L2.5 11.5Z" />
            </svg>
          )}
        </button>

        <button
          id="replay-step-forward"
          className="replay-ctrl-btn"
          onClick={onStepForward}
          disabled={!canForward}
          aria-label="Step forward one candle"
          title="Step forward"
        >
          {/* ▶| */}
          <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor" aria-hidden="true">
            <rect x="10" y="1.5" width="2" height="10" rx="1" />
            <path d="M1.5 1.5 L9 6.5 L1.5 11.5Z" />
          </svg>
        </button>
      </div>

      <div className="replay-divider" aria-hidden="true" />

      {/* ── Speed ──────────────────────────────────────────────────── */}
      <div className="replay-speed-group" role="group" aria-label="Playback speed">
        {SPEEDS.map(({ key, label }) => (
          <button
            key={key}
            id={`replay-speed-${key}`}
            className={`replay-speed-btn${speed === key ? " active" : ""}`}
            onClick={() => onSpeedChange(key)}
            aria-pressed={speed === key}
            title={`${key} speed`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="replay-divider" aria-hidden="true" />

      {/* ── Progress ───────────────────────────────────────────────── */}
      <div className="replay-progress-wrap">
        <div className="replay-progress-track" role="progressbar" aria-valuenow={currentIndex} aria-valuemin={0} aria-valuemax={totalBars}>
          <div
            className="replay-progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="replay-progress-label" aria-label={`Bar ${currentIndex} of ${totalBars}`}>
          {currentIndex.toLocaleString()}
          <span className="replay-progress-sep">/</span>
          {totalBars.toLocaleString()}
        </span>
      </div>

      {/* Push exit to far right */}
      <div style={{ flex: 1 }} />

      {/* ── Exit ───────────────────────────────────────────────────── */}
      <button
        id="replay-exit"
        className="replay-exit-btn"
        onClick={onExit}
        aria-label="Exit replay mode"
        title="Exit replay"
      >
        ✕ Exit Replay
      </button>
    </div>
  );
}
