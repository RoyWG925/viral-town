// A camera "fly to this spot" request from the overlay (cast strip, everyday ticker, compose card).
// PlaybackLayer's CamGlide performs it inside the canvas; the director's camera still wins while it follows a story.
export interface CamAsk {
  x: number;
  z: number;
  /** distance from the spot (keeps the current viewing angle) */
  dist: number;
  /** move the spot this many units to screen-right, e.g. so a resident stands clear of a card docked bottom-left */
  right?: number;
}

export const cam = {
  ask: null as CamAsk | null,
};

export function flyTo(x: number, z: number, dist = 24, right = 0) {
  cam.ask = { x, z, dist, right };
}
