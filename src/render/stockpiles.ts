import type { Storage, Resistance } from '../core/stockpiles';
import { bundleLoad, entries, RESOURCES } from '../core/resources';

/** Original canvas art: roof, visible category stacks, and occupied volume. */
export function drawStockpile(ctx: CanvasRenderingContext2D, store?: Storage, resistance?: Resistance): void {
  if (resistance) {
    ctx.fillStyle = '#584a3b'; ctx.fillRect(-11, -13, 22, 17);
    ctx.fillStyle = resistance === 'fireproof' ? '#b76c49' : resistance === 'acidproof' ? '#629d8b' : '#9f8457';
    ctx.fillRect(-13, -17, 26, 5); ctx.fillRect(-10, -20, 20, 3);
    ctx.fillStyle = '#c7ad7d'; ctx.fillRect(-11, -12, 2, 16); ctx.fillRect(9, -12, 2, 16);
  }
  if (!store) return;
  const groups = { food: 0, material: 0, equipment: store.equipmentVolume ?? 0 };
  for (const [id, n] of entries(store.goods)) groups[RESOURCES[id].kind === 'legacy-food' ? 'food' : RESOURCES[id].kind] += n;
  Object.entries(groups).forEach(([kind, amount], i) => {
    ctx.fillStyle = kind === 'food' ? '#d8b567' : kind === 'material' ? '#99a49a' : '#86a4b4';
    for (let n = 0; n < Math.min(3, Math.ceil(amount / 4)); n++) ctx.fillRect(-10 + i * 7, 4 - n * 3, 6, 2);
  });
  ctx.fillStyle = '#423e32'; ctx.fillRect(-11, 8, 22, 2);
  ctx.fillStyle = '#dec98d'; ctx.fillRect(-11, 8, 22 * Math.min(1, (bundleLoad(store.goods).volume + (store.equipmentVolume ?? 0)) / store.capacity), 2);
}
