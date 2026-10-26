import { roadProblem } from '../core/roads';
import { clouds, cloudDefinitions, cloudRadius } from '../core/clouds';
import { isRoadSurface, ROAD_OVERGROWTH_SECONDS } from '../core/types';
import { TILE_BASE_IDS } from '../core/tiles';
import { unitName } from '../core/units';
import { biomeDefinition } from '../core/natural-biomes';
import { resourceName } from '../render/resources';
import { plantProblem } from '../core/biome-ecology';
import { entries, SOURCE_PROFILES, type ResourceId } from '../core/resources';
import type { World } from '../core/world';
import type { Vec2 } from '../core/types';
import { worldCell } from '../core/world-tiles';
import { translate, type Language } from '../i18n';
import { thermalReasonLabel } from '../core/temperature';

export class TileInspector {
  readonly dialog = document.createElement('dialog');
  private world?: World;
  private point: Vec2 = { x: 0, y: 0 };
  private language: Language = 'en';
  private rendered = '';
  constructor(root: HTMLElement) {
    this.dialog.className = 'tile-dialog'; this.dialog.setAttribute('aria-labelledby', 'tile-title'); root.append(this.dialog);
    this.dialog.addEventListener('click', event => { if ((event.target as HTMLElement).closest('[data-tile-close]')) this.dialog.close(); });
  }
  open(world: World, point: Vec2): void {
    if (!world.terrain.inside(point.x, point.y)) return;
    this.world = world; this.point = { x: Math.floor(point.x) + 0.5, y: Math.floor(point.y) + 0.5 }; this.rendered = '';
    this.render(); if (!this.dialog.open) this.dialog.showModal();
  }
  update(world: World, language: Language): void {
    if (world !== this.world) { this.dialog.close(); this.rendered = ''; }
    if (this.language !== language) this.rendered = '';
    this.world = world; this.language = language;
    if (this.dialog.open) this.render();
  }
  private render(): void {
    const world = this.world!, c = worldCell(world, this.point), tr = (s: string) => translate(s, this.language);
    const ecology = c.biome.ecology, tree = c.objects.find(e => e.components.tree)?.components.tree;
    const harvest = ecology.flora.map(f => entries(SOURCE_PROFILES[f.profile].outputs).map(([id, amount]) => `${resourceName(id, this.language)} ×${amount}`).join(', ')).join(' / ');
    const rows: [string, string][] = [
      ['Position', `${Math.floor(this.point.x)}, ${Math.floor(this.point.y)}`], ['Base terrain', tr(c.base)],
      ['Biome', tr(c.biome.name)], ['Elevation', String(c.elevation)], ['Water depth', String(c.waterDepth)],
      ['Ground cover', tr(c.frost ?? c.surface?.kind ?? 'none')], ['Upper layer', tr(c.top ?? 'none')],
      ['Visual variant', c.variant === undefined ? tr('Automatic') : String(c.variant)],
      ['Walking speed', `${Math.round(c.movement.speed * 100)}%`], ['Construction', tr(c.buildReason ?? 'Allowed')],
      ['Planting', tr(plantProblem(world, this.point, tree?.profile) ?? 'Allowed')],
      ['Biome harvest', harvest || tr('None')],
      ['Natural minerals', Object.keys(ecology.minerals).map(id => resourceName(id as ResourceId, this.language)).join(', ') || tr('None')],
      ['Natural inhabitants', ecology.creatures.map(id => tr(world.registry.species.get(id)!.sourceName)).join(', ') || tr('None')],
      ['Native peoples', ecology.sapients.map(id => tr(world.registry.species.get(id)!.sourceName)).join(', ') || tr('None')],
      ['Settlement adaptation', tr(ecology.adaptation ?? 'None')],
      ['Household income bonus', `${ecology.income > 0 ? '+' : ''}${ecology.income}`],
      ['Ignition chance', `${Math.round(c.burn.chance * 100)}%`], ['Burn rate', String(c.burn.rate)],
      ['Contact damage per second', `${c.lava ? '≤ ' : ''}${c.damagePerSecond}`],
      ['Stored grain', String(c.harvest?.amount ?? 0)], ['Temperature', `${Math.round(c.temperature * 10) / 10} ${tr('heat units')}`],
    ];
    if (c.lavaStage) rows.push(['Lava stage', `${c.lavaStage} / 4`]);
    for (const cloud of clouds(world).filter(cloud => Math.hypot(cloud.x - this.point.x, cloud.y - this.point.y) <= cloudRadius(cloud.size))) {
      rows.push(['Cloud above', `${tr(cloudDefinitions[cloud.type].label)} · ${translate('{seconds} s', this.language, { seconds: Math.ceil(cloud.remaining - 1e-9) })}`],
        ['Last precipitation', tr(cloud.result)]);
    }
    if (c.thermalChange) {
      rows.push(['Thermal cause', tr(thermalReasonLabel[c.thermalChange.reason])]);
      if (c.thermalChange.source?.sourceName) rows.push(['Initiator', c.thermalChange.source.sourceName]);
      else if (c.thermalChange.source?.player) rows.push(['Initiator', tr('Player')]);
    }
    const index = world.terrain.index(this.point.x, this.point.y), wear = world.terrain.roadWear.get(index);
    const road = world.society.roads.find(r => r.tiles.includes(index));
    if (wear || road) {
      const worker = [...world.query('citizen')].find(e => e.components.citizen!.task === 'repair' && e.components.citizen!.repair?.tile === index);
      rows.push(['Road condition', tr(wear?.age === ROAD_OVERGROWTH_SECONDS ? 'Abandoned trail' : isRoadSurface(c.tile)
        ? (wear?.age ?? 0) >= ROAD_OVERGROWTH_SECONDS / 4 ? 'Worn road' : 'Active road' : worker ? 'Road construction' : road && road.tiles.indexOf(index) >= road.built ? 'Waiting for a worker' : 'Road needs repair')]);
      if (wear) rows.push(['Original ground', tr(TILE_BASE_IDS[wear.target])], ['Without traffic', translate('{seconds} s', this.language, { seconds: wear.age })]);
      if (worker) rows.push(['Road worker', unitName(worker)]);
      if (road) rows.push(['Road connection', tr(roadProblem(world, road))]);
    }
    if (tree) rows.push(['Present plant', `${tr(biomeDefinition(tree.biome).name)} · ${tr(plantProblem(world, this.point, tree.profile) ?? 'Allowed')}`]);
    const key = JSON.stringify([rows, c.top, c.entry]); if (this.rendered === key) return; this.rendered = key;
    this.dialog.replaceChildren();
    const header = document.createElement('header'), title = document.createElement('h2'), close = document.createElement('button');
    title.id = 'tile-title'; title.textContent = tr('Inspect cell'); close.type = 'button'; close.dataset.tileClose = ''; close.textContent = tr('Close');
    header.append(title, close); this.dialog.append(header);
    const dl = document.createElement('dl');
    for (const [key, value] of rows) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = tr(key); dd.textContent = value; dl.append(dt, dd); }
    this.dialog.append(dl);
    const note = document.createElement('p'); note.textContent = tr('Soil does not create free food. Workers harvest and transport the field stock.'); this.dialog.append(note);
    if (ecology.adaptation) { const note = document.createElement('p'); note.textContent = tr('Residents keep their origin when the biome changes. New settlers need its adaptation.'); this.dialog.append(note); }
    if (c.top && (c.top.startsWith('wall-') || c.top === 'grey-goo')) {
      const note = document.createElement('p'); note.textContent = tr('This layer retains its place. Its special behavior is not available yet.'); this.dialog.append(note);
    }
    if (c.entry) { const note = document.createElement('p'); note.textContent = tr('Paradox: 10% chance to add one biological year when entering a cell.'); this.dialog.append(note); }
  }
}
