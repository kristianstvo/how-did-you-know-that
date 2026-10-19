// The contract every screen module implements. Screens are pure: HTML out of
// (state, beat time). They never read the clock themselves; the shell passes
// `elapsed` (ms since the phase started on the shared clock), so every phone
// renders the same beat at the same moment and the cheater's screen runs the
// exact same timeline as everyone else's.
import type { PublicState, SecretState } from "../../../shared/protocol";

export interface UiFlags {
  accuseConfirm: boolean;
  myPick: number | null;
  myVote: string | null;
  boardOpen: boolean;
  toast: string | null;
}

export interface App {
  screen: "home" | "game";
  isHost: boolean;
  selfId: string;
  state: PublicState | null;
  secret: SecretState;
  error: string | null;
  closedReason: string | null;
  home: { name: string; code: string; avatar: string; busy: boolean };
  ui: UiFlags;
  fixture: boolean; // replaying a recorded match (no network)
}

export interface RenderCtx {
  app: App;
  s: PublicState; // non-null on every game screen
  now: number; // shared-clock ms
  elapsed: number; // now - s.phaseStartedAt
  reduced: boolean; // prefers-reduced-motion: opacity-only, same timings
}

export interface Screen {
  /** Full screen HTML. Root element must be <section class="screen …">. */
  render(ctx: RenderCtx): string;
  /** A string that changes exactly when a beat boundary is crossed (e.g. the
   *  list of reached beats). The shell re-renders when it changes. */
  beatKey?(ctx: RenderCtx): string;
}
