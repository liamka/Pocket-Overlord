import type { Entity } from '../core/types';
import type { World } from '../core/world';
import { insideMine, mineDemand, mineWeights, mineWorkers, MINE } from '../core/mines';
import { biomeDefinition } from '../core/natural-biomes';
import type { BiomeMineral } from '../content/biome-profiles';
import { resourceName } from './resources';
import { translate, type Language } from '../i18n';

export function mineLines(world: World, mine: Entity, language: Language): string[] {
  const state = mine.components.mine;
  if (!state) return [];
  const workers = mineWorkers(world, mine), inside = workers.filter(insideMine);
  const owner = world.society.villages.find(v => v.id === state.villageId);
  const need = owner ? mineDemand(world, mine, owner) : { limit: 0, reason: 'No owner' };
  const weights = Object.entries(mineWeights(world, mine)) as [BiomeMineral, number][];
  const total = weights.reduce((n, [, w]) => n + w, 0);
  const lines = [translate('Miners inside: {inside}/{capacity} · On the way: {walking}', language,
    { inside: inside.length, capacity: MINE.slots, walking: workers.length - inside.length }),
  translate('Current mine jobs: {count}', language, { count: need.limit }),
  translate('Mine shift: 2–3 months · Chance of a deposit: 60%', language),
  translate('Mine biome: {biome}', language, { biome: translate(biomeDefinition(world.terrain.biomeAt(state.anchor.x, state.anchor.y).id).name, language) }),
  translate('Ore chances after success: {ores}', language, { ores: weights.map(([id, weight]) => `${resourceName(id, language)} ${(weight / total * 100).toFixed(1)}%`).join(', ') })];
  for (const worker of inside) {
    const shift = worker.components.citizen!.work!.mine!;
    lines.push(translate('Miner {id}: {seconds}s left in the shift', language, { id: worker.id, seconds: Math.max(0, Math.ceil((shift.duration - world.tick + shift.enteredAt!) / 30)) }));
  }
  if (need.reason) lines.push(translate(need.reason, language));
  else if (!workers.length) lines.push(translate('Waiting for a worker', language));
  if (state.lastAttempt) lines.push(translate('Last mine shift: {result}', language,
    { result: translate(state.lastAttempt.outcome, language) + (state.lastAttempt.resource ? ` · ${resourceName(state.lastAttempt.resource, language)}` : '') }));
  lines.push(translate('Exposed ore must be mined and carried to storage', language));
  return lines;
}

/** Original pixel timber portal and stone cutting; drawn in the existing canvas. */
export function drawMine(ctx: CanvasRenderingContext2D, entity: Entity, working: boolean, tick: number): void {
  const project = entity.components.building?.project;
  const r = (color: string, x: number, y: number, w: number, h: number) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  r('#25352b66', -21, -5, 43, 18);
  r('#565f57', -20, -8, 40, 18);
  if (entity.components.ruin) {
    for (let i = 0; i < 9; i++) r(i % 2 ? '#8e9381' : '#6c7568', -19 + i * 7 % 35, -9 + i * 3 % 15, 6, 4);
    r('#8e6d44', -14, -9, 3, 15); r('#8e6d44', -8, -2, 22, 3); return;
  }
  const progress = project?.action === 'build' ? project.progress : 1;
  ctx.save(); ctx.beginPath(); ctx.rect(-23, 11 - 41 * progress, 46, 41 * progress); ctx.clip();
  r('#737c70', -18, -20, 36, 29); r('#959a85', -13, -26, 26, 8); r('#a7a993', -8, -28, 16, 3);
  r('#424d46', -14, -12, 28, 22); r('#222c29', -8, -16, 16, 26);
  for (const x of [-11, 8]) { r('#705535', x, -20, 4, 30); r('#c29c60', x, -20, 2, 30); }
  r('#6b5035', -14, -22, 28, 5); r('#c7a066', -14, -22, 28, 2);
  r('#8f958b', -4, 2, 1, 11); r('#8f958b', 4, 2, 1, 11);
  for (let y = 4; y < 14; y += 4) r('#806344', -6, y, 13, 2);
  r('#b98a39', 12, -10, 3, 5); r(working && tick % 30 < 18 ? '#ffe5a0' : '#e3bb62', 12, -9, 2, 3);
  if (working) { r('#6d7571', -4 + Math.floor(tick / 15) % 2, 3, 7, 4); r('#282e2a', -3, 7, 2, 2); r('#282e2a', 2, 7, 2, 2); }
  ctx.restore();
  if (project) { r('#ab8552', -23, -24, 2, 36); r('#ab8552', 21, -24, 2, 36); r('#c9a66d', -23, -11, 46, 2); }
}
