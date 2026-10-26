import { STEP, type SimulationSpeed } from './types';

/** A hidden tab or long frame drops elapsed time instead of simulating a backlog. */
export class FixedClock {
  private previous: number | undefined;
  private accumulator = 0;
  private stepMs = 0;
  constructor(private readonly measure: () => number = () => performance.now(), private readonly budgetMs?: number) {}
  reset(): void { this.previous = undefined; this.accumulator = 0; }
  advance(now: number, active: boolean, step: () => void, speed: SimulationSpeed = 1, availableMs = 10): number {
    if (!active) { this.reset(); return 0; }
    if (this.previous === undefined) { this.previous = now; return 0; }
    const elapsed = (now - this.previous) / 1000;
    this.previous = now;
    if (elapsed < 0 || elapsed > 0.2) { this.accumulator = 0; return 0; }
    this.accumulator += elapsed * speed;
    // Leave time for rendering and input at maximum speed. Never enlarge the physics step.
    const maxSteps = Math.min(2500, Math.max(1, Math.ceil(6 * speed)));
    const budget = Math.max(0, Math.min(10, availableMs, this.budgetMs ?? 4 * Math.sqrt(Math.max(1, speed))));
    const started = this.measure();
    let count = 0, measured = started;
    while (budget > 0 && this.accumulator + 1e-9 >= STEP && count < maxSteps) {
      // One atomic step may exceed the budget; never start another that is unlikely to fit.
      if (count && measured - started + this.stepMs > budget) break;
      step(); this.accumulator -= STEP; count++;
      const end = this.measure();
      // Periodic world maintenance must not price every following step as another spike.
      const cost = end - measured;
      this.stepMs = this.stepMs ? this.stepMs * 0.75 + cost * 0.25 : cost; measured = end;
      if (end - started >= budget) break;
    }
    // Overload drops whole overdue steps; the fractional remainder keeps slow speeds accurate.
    // Otherwise a fast setting leaves an ever-growing backlog after switching back to normal.
    if (this.accumulator + 1e-9 >= STEP) {
      const overdue = Math.floor((this.accumulator + 1e-9) / STEP);
      this.accumulator = Math.max(0, this.accumulator - overdue * STEP);
    }
    return count;
  }
}
