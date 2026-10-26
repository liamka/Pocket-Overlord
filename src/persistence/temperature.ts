import { cellHeatBand, TEMPERATURE } from '../core/temperature';
import { integer, number, record, type RecordValue } from '../core/validation';

/** Scale legacy body accumulation by its ignition threshold, preserve existing flames.
 * Old tile readings were inert: mark crossed bands consumed, never retroactively hurt anyone. */
export function migrateTemperature(save: RecordValue): RecordValue {
  if (!integer(save.tick) || !Array.isArray(save.entities) || !record(save.terrain)) throw new Error('Invalid saved temperature');
  save.terrain.layers ??= [];
  if (!Array.isArray(save.terrain.layers)) throw new Error('Invalid saved temperature');
  for (const entity of save.entities) {
    if (!record(entity) || !record(entity.components) || !record(entity.components.thermal)) continue;
    const c = entity.components, t = entity.components.thermal;
    if (!number(t.temperature, 0, 1e8)) throw new Error('Invalid saved body temperature');
    if (c.unit) {
      const ignition = record(c.combustible) && number(c.combustible.ignition, Number.MIN_VALUE, 1e6) ? c.combustible.ignition : TEMPERATURE.bodyHot;
      t.temperature = t.burning ? 0 : Math.min(TEMPERATURE.bodyHot - 1, t.temperature / ignition * TEMPERATURE.bodyHot);
    } else t.temperature = Math.min(TEMPERATURE.cellMax, t.temperature);
    delete t.lastChange;
  }
  for (const layer of save.terrain.layers) {
    if (!record(layer)) throw new Error('Invalid saved tile temperature');
    if (layer.temperature !== undefined) {
      if (!number(layer.temperature, -273, 10000)) throw new Error('Invalid saved tile temperature');
      layer.temperature = Math.max(TEMPERATURE.cellMin, Math.min(TEMPERATURE.cellMax, layer.temperature));
      layer.thermalAt = save.tick; layer.thermalBand = cellHeatBand(layer.temperature as number);
    }
    delete layer.lavaStage; delete layer.heatSource; delete layer.thermalChange; delete layer.thermalFrost;
  }
  return { ...save, version: 67 };
}
