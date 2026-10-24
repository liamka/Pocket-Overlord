import { STEP, type SimulationSpeed } from './types';

/** A hidden tab or long frame drops elapsed time instead of simulating a backlog. */
export class FixedClock {
  private previous: number | undefined;
  private accumulator = 0;
  constructor(private readonly measure: () => number = () => performance.now(), private readonly budgetMs = 6) {}
  reset(): void { this.previous = undefined; this.accumulator = 0; }
  advance(now: number, active: boolean, step: () => void, speed: SimulationSpeed = 1): number {
    if (!active) { this.reset(); return 0; }
    if (this.previous === undefined) { this.previous = now; return 0; }
    const elapsed = (now - this.previous) / 1000;
    this.previous = now;
    if (elapsed < 0 || elapsed > 0.2) { this.accumulator = 0; return 0; }
    this.accumulator += elapsed * speed;
    // Leave time for rendering and input at maximum speed. Never enlarge the physics step.
    const maxSteps = Math.min(2500, Math.max(1, Math.ceil(6 * speed)));
    const started = this.measure();
    let count = 0;
    while (this.accumulator + 1e-9 >= STEP && count < maxSteps) {
      step(); this.accumulator -= STEP; count++;
      if (this.measure() - started >= this.budgetMs) break;
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
