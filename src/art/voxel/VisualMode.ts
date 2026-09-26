export type VisualMode = 'baseline' | 'voxel';

/** An art pilot only. Comparison A/B remains an independent fixed fixture. */
export function selectVisualMode(search: string, comparison: boolean): VisualMode {
  if (comparison) return 'baseline';
  return new URLSearchParams(search).get('voxelPilot') === '1' ? 'voxel' : 'baseline';
}
