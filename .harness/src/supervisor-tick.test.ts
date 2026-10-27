import { tick } from './supervisor-tick.ts';
import { describe, expect, it } from './test/expect.ts';

describe('tick', () => {
  const ready = { paused: false, configured: true };

  it('fires the harness supervisor with no reasons', () => {
    expect(tick(ready)).toEqual({
      fire: { skill: 'supervise', paused: false, reasons: [] },
      note: 'Firing the harness supervisor for its hourly run.',
    });
  });

  it('fires nothing while paused', () => {
    expect(tick({ ...ready, paused: true })).toEqual({
      note: '**Paused:** `AGENTS_PAUSED` is on, so nothing was fired.',
    });
  });

  it("fires nothing until the routine's secrets are set", () => {
    expect(tick({ ...ready, configured: false }).fire).toBeUndefined();
  });
});
