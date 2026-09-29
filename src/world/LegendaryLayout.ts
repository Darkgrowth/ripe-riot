/** Ground worksite; the suspended melon, load-bearing anchors and landing stay authored separately. */
export const KING_VINE_WORKSITE = { x: -20, z: -35 } as const;
export const KING_MELON_CUT_ROW = { x: -10.2, z: -36, spacing: 1.9 } as const;

/** Approved anchor feet, captured before grading the walking routes. Keeping
 * the suspension rig authored prevents nearby path repairs moving the ropes. */
export const KING_MELON_ANCHOR_FEET = [
  [37.14798367039124, 23.51223419941845, -48.79412827751966],
  [-22.519273958764337, 18.147631281408557, -52.37846597314706],
  [-10.217489793994524, 30, -70.25366982655021],
  [34.70436471391879, 38.21702437525608, -70.41884227349634],
] as const;
