import type { World } from './world';

export interface System {
  id: string;
  before?: readonly string[];
  after?: readonly string[];
  update: (world: World, dt: number) => void;
}

/** Stable topological order, compiled once when a world is created. */
export function orderSystems(systems: Iterable<System>): readonly System[] {
  const remaining = new Map<string, System>();
  for (const system of systems) {
    if (remaining.has(system.id)) throw new Error(`Duplicate system: ${system.id}`);
    remaining.set(system.id, system);
  }
  const dependencies = new Map([...remaining.keys()].map(id => [id, new Set<string>()]));
  for (const system of remaining.values()) {
    for (const id of [...system.before ?? [], ...system.after ?? []]) {
      if (!remaining.has(id)) throw new Error(`Unknown system dependency: ${system.id} → ${id}`);
    }
    for (const id of system.after ?? []) dependencies.get(system.id)!.add(id);
    for (const id of system.before ?? []) dependencies.get(id)!.add(system.id);
  }
  const ordered: System[] = [];
  while (remaining.size) {
    const next = [...remaining.values()].find(system => dependencies.get(system.id)!.size === 0);
    if (!next) throw new Error(`System ordering cycle: ${[...remaining.keys()].join(', ')}`);
    ordered.push(next); remaining.delete(next.id);
    for (const requirements of dependencies.values()) requirements.delete(next.id);
  }
  return Object.freeze(ordered);
}
