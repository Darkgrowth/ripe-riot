export type VisualMode = 'baseline' | 'voxel';

/** Sunpatch ships in voxel style; the old art remains an explicit diagnostic. */
export function selectVisualMode(search: string, comparison: boolean): VisualMode {
  if (comparison) return 'baseline';
  return new URLSearchParams(search).get('voxelPilot') === '0' ? 'baseline' : 'voxel';
}
