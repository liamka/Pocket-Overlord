import { TILE } from './camera';
import { EQUIPMENT, PROJECTILES, type EquipmentSlot } from '../core/equipment-catalog';
import type { World } from '../core/world';
import { translate, type Language } from '../i18n';

export const slotLabel = (slot: EquipmentSlot, language: Language): string => translate(`equipment-slot:${slot}`, language);
export const modifierLabel = (id: string, language: Language): string => translate(`equipment-modifier:${id}`, language);
export function equipmentLabel(id: string, language: Language): string {
  const d = EQUIPMENT[id];
  return d.material ? translate('{type} ({material})', language, { type: translate(`equipment-kind:${d.kind}`, language), material: translate(`equipment-material:${d.material}`, language) })
    : translate(`equipment-kind:${d.kind}`, language);
}
export function drawEquipmentLoot(ctx: CanvasRenderingContext2D, world: World): void {
  for (const item of world.equipment.items) if (item.location.kind === 'ground') {
    const { x, y } = item.location;
    ctx.fillStyle = '#273c2a'; ctx.fillRect(x * TILE - 5, y * TILE - 2, 10, 5);
    ctx.fillStyle = item.favorite || item.modifiers.eternal ? '#f3d381' : '#aab6ac'; ctx.fillRect(x * TILE - 3, y * TILE - 4, 6, 5);
    ctx.fillStyle = '#98724b'; ctx.fillRect(x * TILE, y * TILE - 1, 2, 6);
  }
}
export function drawEquipmentShots(ctx: CanvasRenderingContext2D, world: World): void {
  for (const shot of world.equipment.shots) {
    ctx.save(); ctx.translate(shot.x * TILE, shot.y * TILE - 8); ctx.rotate(Math.atan2(shot.destination.y - shot.y, shot.destination.x - shot.x));
    ctx.fillStyle = PROJECTILES[shot.kind].color;
    if (shot.kind === 'arrow' || shot.kind === 'bone') ctx.fillRect(-5, -1, 9, 2);
    else { ctx.beginPath(); ctx.arc(0, 0, shot.kind === 'pellet' ? 1.5 : 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
}
