import type { ColorRoles } from '../content/phenotypes';
import { hasStatus } from '../core/status-effects';
import { supportsPhenotype } from '../core/phenotypes';
import { isAdult } from '../core/unit-stats';
import type { Entity } from '../core/types';

interface BodyColors extends ColorRoles {
  highlight: boolean;
  legs: string; ears: string; face: string; muzzle: string; earLight: string; tail: string; back: string;
}
/** Inventory of our pre-phenotype art. Saves only stored appearance.variant (clothing/hair),
 * never a skin index or hex color. Version 57 -> 58 maps each species to legacy-<species>.
 * Keep these exact colors, including the sheep's separate fleece, face, ears and legs.
 * Sex, age/size, profession, equipment, village colors and temporary effects are not palettes.
 */
const LEGACY_BODY_COLORS: Readonly<Record<string, ColorRoles & Partial<BodyColors>>> = {
  human: { middle: '#e6bf91', shadow: '#be9068', light: '#e6bf91', accent: '#e6bf91' },
  elf: { middle: '#edcfaa', shadow: '#be9068', light: '#edcfaa', accent: '#edcfaa' },
  orc: { middle: '#8bb456', shadow: '#567a38', light: '#8bb456', accent: '#8bb456' },
  dwarf: { middle: '#e4b986', shadow: '#be9068', light: '#e4b986', accent: '#e4b986' },
  sheep: { middle: '#e8e6cb', shadow: '#b6b8a0', light: '#f8f0d5', accent: '#fff8dc',
    legs: '#65513d', face: '#51493a', muzzle: '#8c8064', earLight: '#b9ae87', tail: '#e6ddbd' },
  dog: { middle: '#be8952', shadow: '#65513d', light: '#e3be83', accent: '#be8952', ears: '#75503a' },
  wolf: { middle: '#83918d', shadow: '#48565a', light: '#b7beb0', accent: '#83918d', ears: '#495b5c' },
};

/** The single body-color resolver for live sprites, airborne sprites and editor previews.
 * Sickness is a read-only visual layer: removing it reveals the same saved phenotype.
 * Historical WorldBox five-shade gradients are neither genes nor additional save fields.
 */
export function resolveBodyColors(speciesId: string, palette?: ColorRoles, sick = false): BodyColors {
  const base = palette ?? LEGACY_BODY_COLORS[speciesId] ?? LEGACY_BODY_COLORS.human;
  const colors: BodyColors = { legs: base.shadow, ears: base.shadow, face: base.shadow, muzzle: base.middle,
    earLight: base.light, tail: base.middle, back: base.shadow, highlight: !!palette, ...base };
  if (sick) {
    colors.middle = speciesId === 'orc' ? '#98a35c' : '#bbb580'; colors.shadow = '#7b8050'; colors.highlight = false;
    if (palette) colors.back = colors.shadow;
  }
  return colors;
}

/** Local art direction: translucent blue ice and violet curse sparks above the body.
 * Fire and selection have independent layers. No saved color is changed.
 * Remains use their resource-pile sprite; posthumous forms use their own species renderer.
 */
export function drawAppearanceOverlay(ctx: CanvasRenderingContext2D, entity: Entity, time: number): void {
  if (!supportsPhenotype(entity.components.creature?.speciesId ?? '') || entity.components.reproduction?.egg) return;
  const frozen = hasStatus(entity, 'frozen'), cursed = hasStatus(entity, 'cursed');
  if (!frozen && !cursed) return;
  ctx.save();
  const animal = !!entity.components.animal;
  if (!isAdult(entity)) ctx.scale(animal ? 0.65 : 0.75, animal ? 0.65 : 0.75);
  const left = animal ? -10 : -6, width = animal ? 21 : 13, top = -16;
  if (cursed) {
    ctx.fillStyle = '#6f457e88'; ctx.fillRect(left, 2, width, 2);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i % 2 ? '#d7a8ee' : '#9962bb';
      const y = top + (Math.floor(time * 5 + entity.id) + i * 6) % 18;
      ctx.fillRect(i % 2 ? left - 2 : left + width, y, 2, 2);
    }
  }
  if (frozen) {
    ctx.fillStyle = '#87cce755'; ctx.fillRect(left, top, width, 19);
    ctx.fillStyle = '#a5e6f2bb'; ctx.fillRect(left, top, 1, 19); ctx.fillRect(left, top, width, 1);
    ctx.fillRect(left + width - 1, top + 1, 1, 18); ctx.fillRect(left, 2, width, 1);
    ctx.fillStyle = '#e4fbffcc'; ctx.fillRect(left + 2, top + 2, 2, 6); ctx.fillRect(left + 4, top + 2, 3, 1);
  }
  ctx.restore();
}

/** The existing fire art, shared by grounded and airborne bodies. */
export function drawBurningOverlay(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  const flicker = Math.floor((Math.sin(time * 19) + 1) * 2);
  ctx.fillStyle = '#d97537'; ctx.fillRect(x - 4, y - 10 - flicker, 8, 10 + flicker);
  ctx.fillStyle = '#efb44d'; ctx.fillRect(x - 2, y - 12 - flicker, 4, 11 + flicker);
  ctx.fillStyle = '#ffe59b'; ctx.fillRect(x - 1, y - 5, 2, 4);
  ctx.fillStyle = '#63726f90'; ctx.fillRect(x + 2, y - 19 - flicker * 2, 4, 4);
}
