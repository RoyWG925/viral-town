// Tiny shared UI state between the 3D scene (clicks on residents) and the React overlay.
export const ui = {
  selected: null as string | null,
  /** residents who take part in the current scenario (clickable, name-tagged) */
  active: new Set<string>(["baker", "florist", "journalist", "cafe", "police", "mayor", "organizer", "vendor"]),
  version: 0,
  /** camera follows whoever is acting during playback */
  follow: true,
  select(npc: string | null) {
    ui.selected = npc;
    ui.version++;
  },
  setActive(ids: string[]) {
    ui.active = new Set(ids);
    ui.version++;
  },
};

// Dev-only handle for automated playthroughs (lab/e2e.mjs).
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") (window as unknown as { __ui: typeof ui }).__ui = ui;
