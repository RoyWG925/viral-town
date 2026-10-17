// Shared, display-only state between the everyday-life scenes, the set dressing and the playback director.
// Nothing here is part of the simulation: it never emits events or touches a resident's mind.

export interface RunningScene {
  id: string;
  /** one short line for the "happening now" ticker, e.g. "🐙 Rosa is griping about the stall fee" */
  label: string;
  at: { x: number; z: number };
  /** safe to show while a story plays (no core residents, no story agents involved) */
  storySafe: boolean;
  /** performance.now() when it started */
  since: number;
}

export const fx = {
  /** performance.now() until which the stage's left-rear post and banner shudder (the stage-rush scene) */
  stageWobbleUntil: 0,
  /** everyday scenes playing right now (written by vignettes.ts, read by the director and the UI ticker) */
  scenes: [] as RunningScene[],
  /** bumps whenever `scenes` changes, so UI can re-render cheaply */
  version: 0,
  /** set by vignettes.ts, called by the director (a bridge, so the two modules never import each other) */
  hooks: {} as {
    endAllScenes?: () => void;
    meanwhileScene?: () => { at: { x: number; z: number }; label: string } | null;
    kickScene?: () => void;
  },
};
