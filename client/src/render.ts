// Rendering core.
// - DOM is MORPHED (idiomorph), never replaced: state broadcasts no longer
//   restart running animations; new elements animate in, kept ones transition.
// - A View Transition runs only when the SCREEN changes (phase / question /
//   match), never per broadcast, and transitions are serialized.
// - A frame loop re-renders exactly when a beat boundary is crossed on the
//   shared clock, and records each beat for the sync/parity tests.
import { Idiomorph } from "idiomorph";
import type { Phase } from "../../shared/protocol";
import { serverNow } from "./clock";
import type { App, RenderCtx, Screen } from "./screens/types";
export type { Screen };

export const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Which kind of screen change this is — picks the View Transition style. */
export type TransitionKind = "slide" | "takeover" | "flip" | "fade" | "rise";

export interface Router {
  /** prevKey = the screen currently on display (for picking the transition). */
  screenFor(app: App, prevKey: string): { key: string; screen: Screen; ctx: RenderCtx | null; transition: TransitionKind };
}

interface BeatRecord {
  key: string; // screenKey|beatKey
  server: number; // shared-clock ms when this phone rendered it
  wall: number; // this machine's Date.now() (for same-machine test comparison)
}

declare global {
  interface Window {
    __hdykt?: { beats: BeatRecord[]; renders: number; transitions: number; phase?: Phase; clock?: () => { offsetMs: number; rttMs: number } };
  }
}

const beatCount = (k: string) => (k ? k.split(",").length : 0);

export function createRenderer(
  root: HTMLElement,
  router: Router,
  app: App,
  afterRender: () => void,
  /** Runs every animation frame (countdown digits flip in step on every phone). */
  afterFrame: () => void,
  onBeat: (screenKey: string, beatKey: string, prevBeatKey: string, settled: boolean) => void = () => {},
) {
  const telemetry = (window.__hdykt = { beats: [] as BeatRecord[], renders: 0, transitions: 0 });
  let lastScreenKey = "";
  let lastBeatKey = "";

  // When several beats are reached at once (host skip, late join, back from a
  // vote) the passed beats render SETTLED: no entrance animations for one
  // frame, so nothing janks and nothing replays.
  // Screens list only DISTINCT beat times in their beatKey (coincident beats
  // are merged), and distinct beats are ≥110ms apart — so crossing two or
  // more in one render means a skip, a late join or a return from a vote.
  const jumped = (screenChanged: boolean, beatKey: string) => beatCount(beatKey) - (screenChanged ? 0 : beatCount(lastBeatKey)) >= 2;
  /** Call right AFTER the morph: every finite animation in the screen jumps to
   *  its end (Web Animations finish()), so nothing replays later. .settle also
   *  zeroes transitions for two frames. Elements that run on the shared clock
   *  (timer bars with negative delays) opt out with data-keep-style. */
  const settle = () => {
    root.classList.add("settle");
    for (const a of root.getAnimations({ subtree: true })) {
      const effect = a.effect as KeyframeEffect | null;
      const target = effect?.target as Element | null;
      if (!effect || effect.getTiming().iterations === Infinity) continue;
      if (target?.closest("[data-keep-style]")) continue;
      try {
        a.finish();
      } catch {
        /* animation with infinite end time */
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("settle")));
  };
  let transitioning: Promise<void> | null = null;
  let callbackDone = false; // the transition's DOM update has run; morphs may proceed
  let pending = false;

  const morph = (html: string) => {
    Idiomorph.morph(root, html, {
      morphStyle: "innerHTML",
      restoreFocus: true,
      callbacks: {
        // Never clobber what someone is typing: skip ONLY a focused text field
        // (skipping any focused element would freeze a just-tapped button).
        beforeNodeMorphed: (oldNode) =>
          !(oldNode === document.activeElement && (oldNode instanceof HTMLInputElement || oldNode instanceof HTMLTextAreaElement)),
        // Keep user/animation-owned attributes: an opened <details>, and
        // inline styles on elements that pin timing to the shared clock.
        beforeAttributeUpdated: (name, el) =>
          !((name === "style" && el.hasAttribute("data-keep-style")) || (name === "open" && el.tagName === "DETAILS")),
      },
    });
  };

  // A new screen starts at its top. Without this, a phone that had scrolled
  // down the grade book opens the vote with the accuser and the timer off
  // screen. Instant, so it lands inside the View Transition's new snapshot.
  const toTop = () => {
    if (scrollY > 0 || scrollX > 0) window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  };

  const htmlFor = (screen: Screen, ctx: RenderCtx | null) =>
    ctx ? screen.render(ctx) : screen.render({ app, s: null as never, now: serverNow(), elapsed: 0, reduced: reducedMotion() });

  // A render asked for from inside one (afterRender can act; on the host an
  // intent re-broadcasts synchronously) runs right after it instead, so the
  // outer render can't overwrite the beat bookkeeping with a stale frame.
  let rendering = false;
  let renderAgain = false;
  function renderNow(): void {
    if (rendering) {
      renderAgain = true;
      return;
    }
    rendering = true;
    try {
      renderOnce();
    } finally {
      rendering = false;
    }
    if (renderAgain) {
      renderAgain = false;
      renderNow();
    }
  }

  function renderOnce(): void {
    const { key, screen, ctx, transition } = router.screenFor(app, lastScreenKey);
    const html = htmlFor(screen, ctx);
    const beatKey = ctx && screen.beatKey ? screen.beatKey(ctx) : "";
    const screenChanged = key !== lastScreenKey;
    const doSettle = jumped(screenChanged, beatKey);
    type VT = { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void> };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => VT };

    if (screenChanged && lastScreenKey && doc.startViewTransition && !transitioning) {
      document.documentElement.dataset.vt = reducedMotion() ? "fade" : transition;
      telemetry.transitions++;
      callbackDone = false;
      const vt = doc.startViewTransition(() => {
        // Render from the LATEST state at swap time (a secret or update may
        // have arrived since the transition was requested).
        const fresh = router.screenFor(app, lastScreenKey === key ? "" : lastScreenKey);
        morph(fresh.key === key ? htmlFor(fresh.screen, fresh.ctx) : html);
        toTop();
        if (doSettle) settle();
        afterRender();
      });
      vt.ready.catch(() => {});
      vt.updateCallbackDone.then(
        () => {
          callbackDone = true;
          if (pending) {
            pending = false;
            renderNow(); // flush anything that arrived before the swap
          }
        },
        () => (callbackDone = true),
      );
      transitioning = vt.finished.catch(() => {}).finally(() => {
        transitioning = null;
        delete document.documentElement.dataset.vt;
        if (pending) {
          pending = false;
          renderNow();
        }
      });
    } else if (transitioning && !callbackDone) {
      pending = true; // the transition callback hasn't applied its state yet
      return;
    } else {
      // Also during a running transition once its DOM update is done: the new
      // view is live, so beats keep their timing instead of waiting it out.
      morph(html);
      if (screenChanged && lastScreenKey) toTop();
      if (doSettle) settle();
      afterRender();
    }
    telemetry.renders++;
    if (screenChanged || beatKey !== lastBeatKey) {
      telemetry.beats.push({ key: `${key}|${beatKey}`, server: serverNow(), wall: Date.now() });
      if (telemetry.beats.length > 2000) telemetry.beats.splice(0, 1000);
      onBeat(key, beatKey, screenChanged ? "" : lastBeatKey, doSettle);
    }
    lastScreenKey = key;
    lastBeatKey = beatKey;
  }

  // Beat clock: cheap per-frame check, re-render only on a boundary crossing.
  function frame(): void {
    try {
      const { key, screen, ctx } = router.screenFor(app, lastScreenKey);
      if (ctx && screen.beatKey && key === lastScreenKey && screen.beatKey(ctx) !== lastBeatKey) renderNow();
      afterFrame();
    } catch (e) {
      console.error(e); // never let one bad render stop the beat clock
    } finally {
      requestAnimationFrame(frame);
    }
  }
  requestAnimationFrame(frame);

  return { render: renderNow };
}
