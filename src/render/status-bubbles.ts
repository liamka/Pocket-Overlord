import { isAdult } from '../core/unit-stats';
import type { Entity, Vec2, VisualEvent } from '../core/types';
import type { World } from '../core/world';

export type StatusIcon = 'heart' | 'weapon';
const HEART_TICKS = 60;
const HEART_LIMIT = 6;
const HEART_SPACING = 3.5;

/** Decorative state follows simulation time, so pausing freezes a new couple's hearts. */
export class StatusBubbles {
  private world: World | undefined;
  private readonly hearts = new Map<number, number>();
  private readonly visibleHearts: Vec2[] = [];
  private readonly warringVillages = new Set<number>();

  update(world: World, visuals: readonly VisualEvent[]): void {
    if (this.world !== world) { this.world = world; this.hearts.clear(); }
    this.visibleHearts.length = 0;
    this.warringVillages.clear();
    for (const war of world.society.wars) {
      for (const id of war.attackers) this.warringVillages.add(id);
      for (const id of war.defenders) this.warringVillages.add(id);
    }
    for (const visual of visuals) if (visual.kind === 'love') {
      const citizen = world.entities.get(visual.target)?.components.citizen;
      const partner = world.entities.get(citizen?.partnerId ?? -1)?.components.citizen;
      if (!citizen || citizen.partnerId === null || partner?.partnerId !== visual.target) continue;
      // Both partners emit the same event; one short notification represents the couple.
      const id = Math.min(visual.target, citizen.partnerId);
      if (!this.hearts.has(id)) this.hearts.set(id, world.tick + HEART_TICKS);
    }
    for (const [id, until] of this.hearts) {
      const citizen = world.entities.get(id)?.components.citizen;
      if (world.tick >= until || !citizen || citizen.partnerId === null || !world.entities.has(citizen.partnerId)) this.hearts.delete(id);
    }
  }

  icon(entity: Entity): StatusIcon | undefined {
    const { person, citizen, thermal } = entity.components;
    if (!person || !isAdult(entity) || !citizen) return;
    if (citizen.task === 'fight' && citizen.villageId !== null && this.warringVillages.has(citizen.villageId)) return 'weapon';
    if (!thermal?.burning && this.hearts.has(entity.id)) return 'heart';
  }

  /** Called only for visible hearts; the bounded list prevents crowded, overlapping badges. */
  placeHeart(position: Vec2): boolean {
    if (this.visibleHearts.length >= HEART_LIMIT || this.visibleHearts.some(p =>
      Math.abs(p.x - position.x) < HEART_SPACING && Math.abs(p.y - position.y) < HEART_SPACING)) return false;
    this.visibleHearts.push(position);
    return true;
  }
}
