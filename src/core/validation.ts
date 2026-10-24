import { WORLD_WIDTH, WORLD_HEIGHT } from './types';

export type RecordValue = Record<string, unknown>;
export type Validator = (value: RecordValue) => boolean;
export interface ValidationContext { width: number; height: number }
export const record = (v: unknown): v is RecordValue => !!v && typeof v === 'object' && !Array.isArray(v);
export const number = (v: unknown, min = -1e8, max = 1e8): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number => number(v, min, max) && Number.isInteger(v);
export const bool = (v: unknown): boolean => typeof v === 'boolean';
export const reference = (v: unknown): boolean => v === null || integer(v, 1);
export const point = (v: unknown): boolean => record(v) && number(v.x, 0, WORLD_WIDTH) && number(v.y, 0, WORLD_HEIGHT);

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
/** Bound traversal and reject non-JSON state, including cycles and non-finite numbers. */
export function isJson(value: unknown): value is JsonValue {
  let remaining = 10000;
  const visit = (v: unknown, depth: number): boolean => {
    if (--remaining < 0 || depth > 32) return false;
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
    if (typeof v === 'number') return Number.isFinite(v);
    if (Array.isArray(v)) return v.every(item => visit(item, depth + 1));
    return record(v) && Object.getPrototypeOf(v) === Object.prototype && Object.values(v).every(item => visit(item, depth + 1));
  };
  return visit(value, 0);
}
