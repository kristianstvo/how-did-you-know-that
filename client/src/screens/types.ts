// The contract every screen module implements. Screens are pure: HTML out of
// (state, beat time). They never read the clock themselves; the shell passes
// `elapsed` (ms since the phase started on the shared clock), so every phone
// renders the same beat at the same moment and the cheater's screen runs the
// exact same timeline as everyone else's.
import type { PublicState, SecretState } from "../../../shared/protocol";

export interface UiFlags {
  accuseConfirm: boolean;
  /** v0.23: whom the armed ACCUSE names (the confirm tap sends it). */
  accuseTarget: string | null;
  /** v0.23: the 👉 sheet also picks whom to accuse ("accuse"). */
  pointMode: "point" | "accuse";
  /** v0.23: the 👉 this phone sent that the host's state doesn't show yet (a
   *  round trip, and pointer broadcasts are coalesced). null = none pending. */
  sentPointer: { id: string | null } | null;
  myPick: number | null;
  /** Classmate tapped on the vote screen but not handed in yet. */
  voteSel: string | null;
  /** Ballot handed in (sent to the host). No take-backs after this. */
  myVote: string | null;
  boardOpen: boolean;
  /** Lobby: the big "scan to join" QR card is up. */
  qrOpen: boolean;
  /** Reveal: the "point at a suspect" sheet is up (v0.5). */
  pointOpen: boolean;
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
  /** v0.21: step 1 is you (name and student), step 2 is where to. `invite`
   *  is the code an invite link (#/join/CODE) brought. */
  home: { name: string; code: string; avatar: string; busy: boolean; resuming?: string; step: 1 | 2; invite?: string };
  ui: UiFlags;
  fixture: boolean; // replaying a recorded match (no network)
  /** v0.16: this page is a big screen (#/tv/CODE): it watches, never plays. */
  tv?: boolean;
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
