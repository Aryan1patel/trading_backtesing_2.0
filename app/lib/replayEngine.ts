/**
 * replayEngine.ts — Phase 4
 *
 * Pure state machine for replay mode. No React, no chart imports.
 * Phase 7 (paper trading) hooks into `getCurrentBar()` to fill
 * simulated orders at the correct price/timestamp.
 */

import type { OHLCBar } from "./dataService";

// ── Types ────────────────────────────────────────────────────────────────

export type ReplaySpeed = "slow" | "normal" | "fast";
export type ReplayStatus = "idle" | "picking" | "paused" | "playing";

/** ms per candle advance at each speed */
export const REPLAY_SPEED_MS: Record<ReplaySpeed, number> = {
  slow: 600,
  normal: 200,
  fast: 50,
};

export interface ReplayState {
  status: ReplayStatus;
  /** How many bars are currently revealed (0 = none) */
  currentIndex: number;
  totalBars: number;
  speed: ReplaySpeed;
}

type StateListener = (state: ReplayState) => void;

// ── Engine ────────────────────────────────────────────────────────────────

export class ReplayEngine {
  private _bars: OHLCBar[] = [];
  private _state: ReplayState = {
    status: "idle",
    currentIndex: 0,
    totalBars: 0,
    speed: "normal",
  };
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _listeners = new Set<StateListener>();

  // ── Subscription ──────────────────────────────────────────────────────

  subscribe(listener: StateListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _emit(): void {
    const snapshot = { ...this._state };
    this._listeners.forEach((fn) => fn(snapshot));
  }

  // ── State transitions ─────────────────────────────────────────────────

  /** Enter replay mode — user must click a candle to set the start point */
  activate(bars: OHLCBar[]): void {
    this._clearTimer();
    this._bars = bars;
    this._state = {
      status: "picking",
      currentIndex: 0,
      totalBars: bars.length,
      speed: this._state.speed, // preserve speed between sessions
    };
    this._emit();
  }

  /** Called when user clicks a candle during "picking" — index is 1-based */
  setStartIndex(index: number): void {
    this._clearTimer();
    const clamped = Math.max(1, Math.min(index, this._state.totalBars));
    this._state = { ...this._state, status: "paused", currentIndex: clamped };
    this._emit();
  }

  play(): void {
    if (
      this._state.status !== "paused" &&
      this._state.status !== "playing"
    )
      return;
    if (this._state.currentIndex >= this._state.totalBars) return;
    this._clearTimer();
    this._state = { ...this._state, status: "playing" };
    this._emit();
    this._startTimer();
  }

  pause(): void {
    if (this._state.status !== "playing") return;
    this._clearTimer();
    this._state = { ...this._state, status: "paused" };
    this._emit();
  }

  stepForward(): void {
    this._clearTimer();
    if (this._state.currentIndex >= this._state.totalBars) return;
    this._state = {
      ...this._state,
      status: "paused",
      currentIndex: this._state.currentIndex + 1,
    };
    this._emit();
  }

  stepBack(): void {
    this._clearTimer();
    if (this._state.currentIndex <= 1) return;
    this._state = {
      ...this._state,
      status: "paused",
      currentIndex: this._state.currentIndex - 1,
    };
    this._emit();
  }

  setSpeed(speed: ReplaySpeed): void {
    const wasPlaying = this._state.status === "playing";
    this._clearTimer();
    this._state = { ...this._state, speed };
    this._emit();
    if (wasPlaying) this._startTimer();
  }

  stop(): void {
    this._clearTimer();
    this._bars = [];
    this._state = {
      status: "idle",
      currentIndex: 0,
      totalBars: 0,
      speed: this._state.speed,
    };
    this._emit();
  }

  // ── Accessors ─────────────────────────────────────────────────────────

  getState(): ReplayState {
    return { ...this._state };
  }

  /**
   * The bar at the current replay tip.
   * Phase 7 paper trading reads this to fill simulated orders at the
   * correct price and timestamp without touching chart internals.
   */
  getCurrentBar(): OHLCBar | null {
    if (this._state.currentIndex === 0 || this._bars.length === 0) return null;
    return this._bars[this._state.currentIndex - 1] ?? null;
  }

  /** All bars visible at the current replay position */
  getVisibleBars(): OHLCBar[] {
    return this._bars.slice(0, this._state.currentIndex);
  }

  // ── Internal timer ────────────────────────────────────────────────────

  private _startTimer(): void {
    this._timer = setInterval(() => {
      if (this._state.currentIndex >= this._state.totalBars) {
        this._clearTimer();
        this._state = { ...this._state, status: "paused" };
        this._emit();
        return;
      }
      this._state = {
        ...this._state,
        currentIndex: this._state.currentIndex + 1,
      };
      this._emit();
    }, REPLAY_SPEED_MS[this._state.speed]);
  }

  private _clearTimer(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}
