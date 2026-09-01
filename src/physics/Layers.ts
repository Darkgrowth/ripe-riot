/**
 * Rapier collision groups are a u32: high 16 bits = membership, low 16 = filter.
 * Keep every group here so interaction rules are readable in one place.
 */
export const Layer = {
  WORLD:   1 << 0,  // terrain, static geometry
  PROP:    1 << 1,  // crates, ladders, dock furniture
  PLAYER:  1 << 2,
  FRUIT:   1 << 3,
  TOOL:    1 << 4,  // projectiles, harpoons, net bodies
  ROPE:    1 << 5,  // rope segment bodies
  TRIGGER: 1 << 6,  // sensors (sell zone, shop, area triggers)
  PLANT:   1 << 7,  // trunks, branches
  VEHICLE: 1 << 8,
  DEBRIS:  1 << 9,  // low-priority, collides with world only
} as const;

export type LayerName = keyof typeof Layer;

export const ALL = 0xffff;

/** Pack membership + filter into Rapier's collision-group u32. */
export function groups(member: number, collidesWith: number): number {
  return ((member & 0xffff) << 16) | (collidesWith & 0xffff);
}

const S = Layer;

/** Canonical group values, so call-sites read as intent rather than bit math. */
export const Groups = {
  world:   groups(S.WORLD, ALL),
  prop:    groups(S.PROP, ALL),
  plant:   groups(S.PLANT, ALL),
  player:  groups(S.PLAYER, S.WORLD | S.PROP | S.FRUIT | S.PLANT | S.TRIGGER | S.VEHICLE | S.TOOL | S.ROPE),
  fruit:   groups(S.FRUIT, S.WORLD | S.PROP | S.PLAYER | S.FRUIT | S.PLANT | S.TOOL | S.ROPE | S.TRIGGER | S.VEHICLE),
  tool:    groups(S.TOOL, S.WORLD | S.PROP | S.FRUIT | S.PLANT | S.PLAYER | S.VEHICLE),
  rope:    groups(S.ROPE, S.WORLD | S.PROP | S.FRUIT | S.PLANT | S.PLAYER),
  trigger: groups(S.TRIGGER, S.PLAYER | S.FRUIT | S.VEHICLE),
  vehicle: groups(S.VEHICLE, ALL),
  debris:  groups(S.DEBRIS, S.WORLD | S.PROP),
} as const;

/** Query filter masks for raycasts (which membership bits we want to hit). */
export const QueryMask = {
  solid:      groups(ALL, S.WORLD | S.PROP | S.PLANT | S.VEHICLE),
  solidFruit: groups(ALL, S.WORLD | S.PROP | S.PLANT | S.VEHICLE | S.FRUIT),
  interact:   groups(ALL, S.WORLD | S.PROP | S.PLANT | S.FRUIT | S.VEHICLE | S.TRIGGER),
  groundOnly: groups(ALL, S.WORLD | S.PROP | S.VEHICLE),
  anything:   groups(ALL, ALL),
} as const;
