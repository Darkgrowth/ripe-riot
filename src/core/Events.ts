/**
 * Minimal typed event bus. Systems talk through this rather than holding
 * references to each other, which keeps the dependency graph shallow and makes
 * multiplayer interception (see net/MultiplayerAuthority) a single choke point.
 */
export type Handler<T> = (payload: T) => void;

export class EventBus<M extends object> {
  private map = new Map<keyof M, Set<Handler<never>>>();

  on<K extends keyof M>(key: K, fn: Handler<M[K]>): () => void {
    let set = this.map.get(key);
    if (!set) { set = new Set(); this.map.set(key, set); }
    set.add(fn as Handler<never>);
    return () => { set!.delete(fn as Handler<never>); };
  }

  once<K extends keyof M>(key: K, fn: Handler<M[K]>): () => void {
    const off = this.on(key, (p) => { off(); fn(p); });
    return off;
  }

  emit<K extends keyof M>(key: K, payload: M[K]): void {
    const set = this.map.get(key);
    if (!set) return;
    // Copy so handlers can unsubscribe mid-dispatch.
    for (const fn of Array.from(set)) (fn as Handler<M[K]>)(payload);
  }

  clear(): void { this.map.clear(); }
}
