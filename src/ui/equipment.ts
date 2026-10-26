import { calendarDate } from './calendar';
import { EQUIPMENT, EQUIPMENT_SLOTS, MODIFIER_RULES, PROJECTILES, itemRarity } from '../core/equipment-catalog';
import { editItem, equipmentBonuses, equippedItem, itemValue, replacementReason, wornOutLeather, type EquipmentItem, type ItemLocation } from '../core/equipment';
import type { World } from '../core/world';
import { residentName } from '../core/village-life';
import { canOpenUnitEditor } from '../core/capabilities';
import { translate, type Language } from '../i18n';
import { equipmentLabel, modifierLabel, slotLabel } from '../render/equipment';
import { boneRecipeLines, gemRecipeLines, metalworkingLines, resourceText } from '../render/resources';
import { activeOrder } from '../core/crafting';
import { metalExperience } from '../core/common-metals';
import { SILVER } from '../core/silver';
import { availableStock, inTransit, stockOf } from '../core/resource-ledger';
import { LEATHER } from '../core/leather';
import { jobVacancy, supplyTarget } from '../core/jobs';
import { entries } from '../core/resources';

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export class EquipmentInspector {
  readonly dialog = document.createElement('dialog');
  private world?: World;
  private language: Language = 'en';
  private residentId = 0;
  private itemId = 0;
  private queueTick = -1;
  constructor(root: HTMLElement, button: HTMLButtonElement) {
    this.dialog.id = 'equipment-dialog'; this.dialog.setAttribute('aria-labelledby', 'equipment-title'); root.append(this.dialog);
    button.addEventListener('click', () => { if (this.world) { this.render(); this.dialog.showModal(); } });
    this.dialog.addEventListener('change', event => {
      const select = event.target as HTMLSelectElement;
      if (select.id === 'equipment-resident') this.residentId = Number(select.value);
      if (select.id === 'equipment-item') this.itemId = Number(select.value);
      if (select.id !== 'equipment-transmute') this.render();
    });
    this.dialog.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button) return;
      if (button.dataset.close !== undefined) { this.dialog.close(); return; }
      if (button.dataset.item) { this.itemId = Number(button.dataset.item); this.render(); return; }
      const action = button.dataset.edit;
      if (this.world && (action === 'favorite' || action === 'reforge' || action === 'transmute')) {
        const definition = this.dialog.querySelector<HTMLSelectElement>('#equipment-transmute')?.value;
        editItem(this.world, this.itemId, action, definition); this.render();
      }
    });
  }
  update(world: World, language: Language): void {
    this.world = world; this.language = language;
    if (this.dialog.open && this.queueTick !== Math.floor(world.tick / 15)) {
      this.queueTick = Math.floor(world.tick / 15);
      const queue = this.dialog.querySelector('#crafting-queue');
      if (queue) queue.innerHTML = this.queue();
      const detail = this.dialog.querySelector<HTMLElement>('.equipment-detail');
      const item = world.equipment.items.find(i => i.id === this.itemId);
      if (detail && item && detail.dataset.condition !== String(item.durability)) detail.outerHTML = this.details(item);
      for (const panel of this.dialog.querySelectorAll<HTMLElement>('[data-silver-recipe]')) {
        const next = this.silverRecipeDetails(panel.dataset.silverRecipe!, panel.dataset.cost === 'true');
        if (panel.outerHTML !== next) panel.outerHTML = next;
      }
    }
  }
  openFor(id: number): void {
    const entity = this.world?.entities.get(id);
    if (!this.world || !entity || !canOpenUnitEditor(this.world.registry, entity, 'equipment')) return;
    this.residentId = id; this.itemId = 0; this.render(); this.dialog.showModal();
  }
  private tr(source: string, values: Record<string, string | number> = {}): string { return translate(source, this.language, values); }
  private location(l: ItemLocation): string {
    return l.kind === 'equipped' || l.kind === 'carried' ? this.tr(l.kind === 'equipped' ? 'Worn by {name}' : 'Carried by {name}', { name: residentName(l.entityId, this.world) })
      : l.kind === 'stored' ? this.tr('Stored in building {id}', { id: l.buildingId }) : this.tr('Loot at {x}, {y}', { x: l.x.toFixed(1), y: l.y.toFixed(1) });
  }
  private itemName(item: EquipmentItem): string { return item.name || equipmentLabel(item.definition, this.language); }
  private render(): void {
    const world = this.world!;
    const residents = [...world.query('person', 'citizen')].filter(e => canOpenUnitEditor(world.registry, e, 'equipment'));
    if (!residents.some(e => e.id === this.residentId)) this.residentId = residents[0]?.id ?? 0;
    const resident = world.entities.get(this.residentId);
    let item = world.equipment.items.find(i => i.id === this.itemId);
    item ??= resident && equippedItem(world, resident.id, 'weapon') || world.equipment.items[0];
    this.itemId = item?.id ?? 0;
    const tr = (s: string, v?: Record<string, string | number>): string => escape(this.tr(s, v));
    const selected = (id: number, current: number): string => id === current ? ' selected' : '';

    const slots = resident ? EQUIPMENT_SLOTS.map(slot => {
      const worn = equippedItem(world, resident.id, slot);
      return `<li><strong>${escape(slotLabel(slot, this.language))}</strong> ${worn ? `<button type="button" data-item="${worn.id}">${escape(this.itemName(worn))}</button>` : tr('Empty slot')}</li>`;
    }).join('') : '';
    const bonuses = resident ? equipmentBonuses(world, resident) : undefined;
    const stats = bonuses ? tr('Equipment bonuses: damage {damage}, defense {armor}, health {health}, speed {speed}%, critical {critical}%, attack speed {attackSpeed}%', {
      ...bonuses, speed: Math.round(bonuses.speed * 100), critical: Math.round(bonuses.critical * 100), attackSpeed: Math.round(bonuses.attackSpeed * 100),
    }) : '';
    const extra = bonuses ? tr('Intelligence {intelligence} · Warfare {warfare} · Diplomacy {diplomacy}', bonuses) : '';
    const reason = item && resident && replacementReason(world, resident, item);
    this.dialog.innerHTML = `<h2 id="equipment-title">${tr('Equipment')}</h2>
      <label for="equipment-resident">${tr('Resident')}</label><select id="equipment-resident">${residents.map(e => `<option value="${e.id}"${selected(e.id, this.residentId)}>${escape(residentName(e.id, this.world))}</option>`).join('')}</select>
      <ul class="equipment-slots">${slots}</ul><p>${stats}</p><p>${extra}</p>
      <label for="equipment-item">${tr('Item')}</label><select id="equipment-item">${world.equipment.items.map(i => `<option value="${i.id}"${selected(i.id, this.itemId)}>#${i.id} ${escape(this.itemName(i))} · ${escape(this.location(i.location))}</option>`).join('')}</select>
      ${item ? this.details(item) : `<p>${tr('No equipment yet. A workshop can make stone axes.')}</p>`}
      ${reason ? `<p role="status">${escape(this.tr(reason))}</p>` : ''}
      <p>${tr('Residents collect better equipment in person. Full stores leave old items on the ground.')}</p>
      <section id="crafting-queue" aria-label="${tr('Workshop orders')}">${this.queue()}</section>
      <details><summary>${tr('Equipment catalogue')}</summary>${Object.values(EQUIPMENT).map(d => `<p>${escape(equipmentLabel(d.id, this.language))} — ${tr(d.recipe.reason)}${d.recipe.inputs.gems ? `<br>${tr('Recipe cost: {goods}', { goods: resourceText(d.recipe.inputs, this.language) })}<br>${gemRecipeLines(world, resident?.components.citizen?.villageId, d.recipe.inputs.gems, this.language).map(escape).join('<br>')}` : ''}</p>${d.material === 'bone' ? boneRecipeLines(this.language).map(line => `<p>${escape(line)}</p>`).join('') : ''}${d.material === 'leather' ? `<p>${tr('Recipe cost: {goods}', { goods: resourceText(d.recipe.inputs, this.language) })} · ${tr('Damage {damage} · Defense {armor} · Critical {critical}% · Durability {durability}', { damage: d.damage, armor: d.armor, critical: 0, durability: d.durability })}${d.speed ? ` · ${tr('Movement bonus: {speed}%', { speed: Math.round(d.speed * 100) })}` : ''}</p>` : ''}${this.silverRecipeDetails(d.id, !d.recipe.inputs.gems)}`).join('')}</details>
      <div class="dialog-actions"><button type="button" data-close>${tr('Done')}</button></div>`;
  }
  private queue(): string {
    const world = this.world!, tr = (s: string, v?: Record<string, string | number>): string => escape(this.tr(s, v));
    const villageId = world.entities.get(this.residentId)?.components.citizen?.villageId;
    const village = world.society.villages.find(v => v.id === villageId);
    const orders = world.crafting.orders.filter(o => villageId == null || o.villageId === villageId);
    const shown = [...orders.filter(o => o.state === 'working' || o.state === 'delivering'),
      ...orders.filter(o => !activeOrder(o)).slice(-3).reverse(),
      ...orders.filter(o => o.state === 'waiting').sort((a, b) => Number(b.recipientId === this.residentId) - Number(a.recipientId === this.residentId) || a.id - b.id)].slice(0, 24);
    const rows = shown.map(o => `<li><strong>#${o.id} ${escape(equipmentLabel(o.recipe, this.language))}</strong> · ${tr('crafting:' + o.reason)}
      <br>${tr('Recipient: {name} · Maker: {maker}', { name: o.recipientId === null ? this.tr('Village stock') : residentName(o.recipientId, this.world), maker: o.workerId === null ? '—' : residentName(o.workerId, this.world) })}
      <br>${tr('Work {progress}% · Materials: {goods}', { progress: Math.round(o.progress / EQUIPMENT[o.recipe].recipe.work * 100), goods: resourceText(o.inputs, this.language) })}
      <br>${tr('Coins to craft: {craft} · To repair: {repair}', { craft: o.coins ?? '—', repair: o.coins === null ? '—' : Math.ceil(o.coins / 2) })}
      · ${tr(o.paid ? 'Materials paid' : o.state === 'working' ? 'Materials reserved' : 'Materials not spent')}
      ${!o.paid && o.state === 'waiting' && o.inputs.gems ? `<br>${gemRecipeLines(world, o.villageId, o.inputs.gems, this.language).map(escape).join('<br>')}` : ''}
      ${o.inputs.bone ? `<br>${boneRecipeLines(this.language).map(escape).join('<br>')}` : ''}
      ${o.resultId === null ? '' : `<button type="button" data-item="${o.resultId}">${tr('Item')} #${o.resultId}</button>`}</li>`).join('');
    const resident = world.entities.get(this.residentId);
    const cursed = resident && EQUIPMENT_SLOTS.some(slot => equippedItem(world, resident.id, slot)?.modifiers.cursed);
    return `<h3>${tr('Workshop orders')} (${orders.filter(activeOrder).length})</h3>
      <p>${tr('Materials are paid on completion. Cancelling unfinished work releases its reservation.')}</p>
      ${village ? metalworkingLines(world, village, this.language).map(line => `<p>${escape(line)}</p>`).join('') : ''}
      ${village ? `<p>${tr('Leather: stored {stock}, carried {cargo}, target {target}', { stock: stockOf(village, 'leather'), cargo: inTransit(world, village.id).leather ?? 0, target: supplyTarget(world, village, 'leather') })}</p>
      <p>${tr('Hunters leave young animals and {reserve} breeding adults in each herd.', { reserve: LEATHER.breedingReserve })} ${tr(jobVacancy(world, village, 'hunter').reason ?? 'Hunter')}</p>` : ''}
      ${cursed ? `<p>${tr('A cursed item cannot be replaced')}</p>` : ''}<ol>${rows || `<li>${tr('No workshop orders')}</li>`}</ol>`;
  }
  private details(item: EquipmentItem): string {
    const d = EQUIPMENT[item.definition], tr = (s: string, v?: Record<string, string | number>): string => escape(this.tr(s, v));
    const mods = Object.entries(item.modifiers).map(([m, level]) => `${escape(modifierLabel(m, this.language))} ${level}/${MODIFIER_RULES[m as keyof typeof MODIFIER_RULES].max}`).join(' · ');
    const projectile = d.attack.projectile && PROJECTILES[d.attack.projectile];
    const statuses = [...new Set([...d.attack.statuses, ...(projectile?.status ? [projectile.status] : [])])];
    const effects = statuses.map(s => modifierLabel(s, this.language)).join(', ');
    const candidates = Object.values(EQUIPMENT).filter(next => next.slot === d.slot).map(next => `<option value="${next.id}"${next.id === d.id ? ' selected' : ''}>${escape(equipmentLabel(next.id, this.language))}</option>`).join('');
    return `<article class="equipment-detail" data-condition="${item.durability}"><h3>${escape(this.itemName(item))} #${item.id} · ${tr(itemRarity(item.modifiers))}</h3>
      ${d.material ? `<p>${tr('Material: {material}', { material: this.tr('equipment-material:' + d.material) })}</p>` : ''}
      <p>${tr('Value {value} · Condition {current}/{max}', { value: itemValue(item), current: item.durability, max: item.maxDurability })}</p>
      <p>${tr('Damage {damage} · Defense {armor} · Reach {range} · Targets {targets}', { damage: wornOutLeather(item) ? 0 : d.damage, armor: wornOutLeather(item) ? 0 : d.armor, range: d.attack.range, targets: d.attack.targets })}</p>
      ${d.speed ? `<p>${tr('Movement bonus: {speed}%', { speed: wornOutLeather(item) ? 0 : Math.round(d.speed * 100) })}</p>` : ''}
      ${d.material === 'leather' ? `<p>${tr('Leather wears with damaging hits. Worn items give no bonuses; replacement returns no raw leather.')}</p>` : ''}
      ${d.material === 'stone' ? `<p>${tr('Time between strikes: ×{interval}', { interval: d.attack.interval ?? 1 })}</p>` : ''}
      ${projectile ? `<p>${tr('Projectile: {kind} · Speed {speed}', { kind: this.tr(`equipment-projectile:${d.attack.projectile}`), speed: projectile.speed })}</p>` : ''}
      ${effects ? `<p>${tr('On hit: {effects}', { effects })}</p>` : ''}
      <p>${tr('Author: {name} · Created: {date}', { name: item.author.name || this.tr('Unknown author'), date: calendarDate(item.createdAt, this.language) })}</p>
      ${item.origin ? `<p>${tr('Workshop {workshop} · Order {order}', { workshop: item.origin.workplaceId, order: item.origin.orderId })}</p>` : ''}
      <p>${escape(this.location(item.location))}${item.claim ? ` · ${tr('Awaiting pickup by {name}', { name: residentName(item.claim, this.world) })}` : ''}</p>
      <p>${mods || tr('No modifiers')}${item.playerMarked ? ` · ${tr('Changed by the player')}` : ''}</p>
      <p>${tr(d.recipe.reason)}</p>
      <p>${tr('Recipe cost: {goods}', { goods: resourceText(d.recipe.inputs, this.language) })}</p>
      ${this.silverRecipeDetails(d.id, false)}
      ${d.material === 'bone' ? boneRecipeLines(this.language).map(line => `<p>${escape(line)}</p>`).join('') : ''}
      ${gemRecipeLines(this.world!, this.world!.entities.get(this.residentId)?.components.citizen?.villageId, d.recipe.inputs.gems ?? 0, this.language).map(line => `<p>${escape(line)}</p>`).join('')}
      <div class="equipment-actions"><button type="button" data-edit="favorite" aria-pressed="${item.favorite}">${tr('Favorite')}</button><button type="button" data-edit="reforge">${tr('Reforge')}</button></div>
      <label for="equipment-transmute">${tr('Transmute within this slot')}</label><select id="equipment-transmute">${candidates}</select><button type="button" data-edit="transmute">${tr('Transmute')}</button>
      <details><summary>${tr('Ownership history')}</summary><ol>${item.history.map(h => `<li>${escape(calendarDate(h.tick, this.language))}: ${tr(`equipment-history:${h.reason}`)} · ${escape(this.location(h.location))}</li>`).join('')}</ol></details></article>`;
  }
  private silverRecipeDetails(id: string, includeCost = true): string {
    const d = EQUIPMENT[id];
    if (d.material !== 'silver') return '';
    const world = this.world!, villageId = world.entities.get(this.residentId)?.components.citizen?.villageId;
    const village = world.society.villages.find(v => v.id === villageId);
    const current = village ? metalExperience(village) : 0;
    const missing = Object.fromEntries(entries(d.recipe.inputs).map(([key, n]) => [key, Math.max(0, n - (village ? availableStock(world, village, key) : 0))]));
    const tr = (s: string, v?: Record<string, string | number>): string => escape(this.tr(s, v));
    return `<div class="silver-recipe" data-silver-recipe="${id}" data-cost="${includeCost}">${includeCost ? `<p>${tr('Recipe cost: {goods}', { goods: resourceText(d.recipe.inputs, this.language) })}</p>` : ''}
      <p>${tr('Workshop experience: {current}/{required}', { current, required: SILVER.requires })} · ${current < SILVER.requires ? tr('crafting:knowledge') : Object.values(missing).some(n => n > 0) ? tr('Missing ingredients: {goods}', { goods: resourceText(missing, this.language) }) : tr('Materials and experience are sufficient')}</p>
      <p>${tr('Damage {damage} · Defense {armor} · Critical {critical}% · Durability {durability}', { damage: d.damage, armor: d.armor, critical: Math.round((d.critical ?? 0) * 100), durability: d.durability })}</p></div>`;
  }
}
