import { describe, expect, it } from 'vitest';
import { StatusBubbles } from '../src/render/status-bubbles';
import { World } from '../src/core/world';
import { declareWar, endWar, formAlliance } from '../src/systems/diplomacy';
import { settlement } from '../src/systems/people';
import { advance, diplomaticWorld } from './helpers';

describe('resident status bubbles', () => {
  it('shows one short heart per couple and freezes its remaining lifetime on pause', () => {
    const world = diplomaticWorld(2), bubbles = new StatusBubbles();
    for (const e of world.query('person')) e.components.person!.reproduceIn = 999;
    world.tick = 30; settlement(world);
    const people = [...world.query('person')];
    expect(world.visuals.filter(v => v.kind === 'love').map(v => v.kind === 'love' && v.target).sort()).toEqual(people.map(e => e.id).sort());
    bubbles.update(world, world.visuals.splice(0));
    const hearts = people.filter(e => bubbles.icon(e) === 'heart');
    expect(hearts).toHaveLength(people.length / 2);
    for (const e of hearts) expect(bubbles.icon(world.entities.get(e.components.citizen!.partnerId!)!)).toBeUndefined();
    world.paused = true; advance(world, 20); bubbles.update(world, []);
    expect(people.filter(e => bubbles.icon(e) === 'heart')).toEqual(hearts);
    world.paused = false; world.tick += 60; settlement(world); bubbles.update(world, world.visuals.splice(0));
    for (const e of people) expect(bubbles.icon(e)).toBeUndefined();
  });

  it('drops a departed partner and never carries transient hearts into another world', () => {
    const world = diplomaticWorld(2), bubbles = new StatusBubbles();
    world.tick = 30; settlement(world); bubbles.update(world, world.visuals.splice(0));
    const person = [...world.query('person')][0];
    expect(bubbles.icon(person)).toBe('heart');
    world.remove(person.components.citizen!.partnerId!); bubbles.update(world, []);
    expect(bubbles.icon(person)).toBeUndefined();
    const replacement = diplomaticWorld(2); bubbles.update(replacement, []);
    for (const e of replacement.query('person')) expect(bubbles.icon(e)).toBeUndefined();
  });

  it('shows weapons for allied soldiers during mustering and marching, then clears them at peace', () => {
    const world = diplomaticWorld(4), bubbles = new StatusBubbles();
    formAlliance(world, 1, 2); const war = declareWar(world, 1, 3)!;
    advance(world, 0.5); bubbles.update(world, []);
    const soldiers = [...world.query('person')].filter(e => e.components.citizen!.task === 'fight');
    expect(soldiers.length).toBeGreaterThan(0);
    expect(new Set(soldiers.map(e => e.components.citizen!.villageId))).toEqual(new Set([1, 2, 3]));
    for (const e of soldiers) expect(bubbles.icon(e)).toBe('weapon');
    const civilian = [...world.query('person')].find(e => e.components.citizen!.villageId === 4)!;
    expect(bubbles.icon(civilian)).not.toBe('weapon');
    soldiers[0].components.citizen!.pregnancy = 2;
    expect(bubbles.icon(soldiers[0])).toBe('weapon');
    world.tick = war.musterUntil; bubbles.update(world, []);
    for (const e of soldiers) expect(bubbles.icon(e)).toBe('weapon');
    endWar(world, war, 'Мир'); bubbles.update(world, []);
    for (const e of soldiers) expect(bubbles.icon(e)).not.toBe('weapon');
  });

  it('does not turn a saved or delayed pregnancy into a permanent heart', () => {
    const world = diplomaticWorld(2), person = [...world.query('person')][0], bubbles = new StatusBubbles();
    world.tick = 30; settlement(world);
    person.components.citizen!.pregnancy = 4;
    person.components.citizen!.fatherId = person.components.citizen!.partnerId;
    const restored = new World(world.seed, world.registry, world.snapshot());
    const mother = restored.entities.get(person.id)!;
    bubbles.update(restored, []); expect(bubbles.icon(mother)).toBeUndefined();
    mother.components.citizen!.pregnancy = 0.01;
    restored.tick += 600; bubbles.update(restored, []);
    expect(bubbles.icon(mother)).toBeUndefined();
    bubbles.update(restored, [{ kind: 'love', target: mother.id, ...mother.components.position!, radius: 1 }]);
    expect(bubbles.icon(mother)).toBe('heart');
    mother.components.thermal!.burning = true;
    expect(bubbles.icon(mother)).toBeUndefined();
    mother.components.thermal!.burning = false; mother.components.person!.age = 5;
    expect(bubbles.icon(mother)).toBeUndefined();
  });

  it('does not prolong a notification when both partner events arrive on different frames', () => {
    const world = diplomaticWorld(2), bubbles = new StatusBubbles();
    world.tick = 30; settlement(world);
    const person = [...world.query('person')][0], event = { kind: 'love' as const, target: person.id, ...person.components.position!, radius: 1 };
    bubbles.update(world, [event]); expect(bubbles.icon(person)).toBe('heart');
    world.tick += 45; bubbles.update(world, [{ ...event, target: person.components.citizen!.partnerId! }]);
    world.tick += 15; bubbles.update(world, []); expect(bubbles.icon(person)).toBeUndefined();
  });

  it('keeps nearby hearts apart and bounds visible notifications on every frame', () => {
    const world = diplomaticWorld(2), bubbles = new StatusBubbles(); bubbles.update(world, []);
    expect(bubbles.placeHeart({ x: 10, y: 10 })).toBe(true);
    expect(bubbles.placeHeart({ x: 11, y: 12 })).toBe(false);
    const shown = Array.from({ length: 20 }, (_, i) => bubbles.placeHeart({ x: 15 + i * 4, y: 10 })).filter(Boolean);
    expect(shown).toHaveLength(5);
    bubbles.update(world, []);
    expect(bubbles.placeHeart({ x: 11, y: 12 })).toBe(true);
  });
});
