// "?lite" in the URL: no post-processing or shadows, and larger simulation steps, so automated
// playthroughs in a software-rendered headless browser still play at real speed (lab/e2e.mjs).
export const LITE = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("lite");
/** Longest frame step the town simulates at once (seconds). */
export const DT_MAX = LITE ? 0.25 : 0.05;
