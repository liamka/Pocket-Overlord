import { JOBS, jobVacancies, professionOf } from '../core/jobs';
import { entityLabel } from '../core/units';
import { residentName } from '../core/village-life';
import type { Entity, Village } from '../core/types';
import type { World } from '../core/world';
import { resourceName } from '../render/resources';
import { equipmentLabel } from '../render/equipment';
import { translate, type Language } from '../i18n';

export function residentJobLines(world: World, entity: Entity, language: Language): string[] {
  const c = entity.components.citizen;
  if (!c) return [];
  const tr = (key: string): string => translate(key, language), role = professionOf(world, entity);
  const office = role.office === 'king' ? 'King' : role.office === 'leader' ? 'Village leader' : 'Civilian';
  const profession = tr(office) + (role.service !== 'civilian' ? ` · ${tr(role.service === 'captain' ? 'Captain' : 'Warrior')}` : '');
  const result = [`${tr('Profession')}: ${profession}`], job = c.jobAssignment;
  result.push(`${tr('Assigned job')}: ${job ? tr(JOBS[job.kind]) : tr('No current assignment')}`);
  if (job) {
    const target = world.entities.get(job.targetId ?? -1);
    const order = world.crafting.orders.find(o => o.id === c.work?.orderId);
    const goal = order ? equipmentLabel(order.recipe, language) : job.output ? resourceName(job.output, language)
      : job.kind === 'roadBuilder' ? tr('Damaged road') : target ? tr(entityLabel(world, target)) : '';
    if (goal) result.push(`${tr('Production goal')}: ${goal}`);
  } else if (c.jobProblem) result.push(`${tr(JOBS[c.jobProblem.kind])}: ${tr(c.jobProblem.reason)}`);
  return result;
}

export function villageJobLines(world: World, village: Village, language: Language): string[] {
  const tr = (key: string, values?: Record<string, string | number>): string => translate(key, language, values);
  return jobVacancies(world, village).flatMap(job => {
    const names = [...world.query('citizen')].filter(e => e.components.citizen!.jobAssignment?.villageId === village.id && e.components.citizen!.jobAssignment!.kind === job.kind)
      .map(e => residentName(e.id, world)).join(', ');
    const lines = [`${tr(JOBS[job.kind])} · ${tr('Workers: {filled}/{limit} · Needed: {shortage}', { filled: job.filled, limit: Math.max(job.filled, job.limit), shortage: job.shortage })}${job.reason ? ` · ${tr(job.reason)}` : ''}`];
    if (names) lines.push(tr('Assigned to: {names}', { names }));
    if (job.kind === 'farmer') lines.push(`${tr('Fertilizer')}: ${tr('No fertilizer available')}`);
    return lines;
  });
}
