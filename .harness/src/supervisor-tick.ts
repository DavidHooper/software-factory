/**
 * The tick (cli/supervisor-tick.ts): the harness supervisor routine's hourly
 * run can't read the kill switch (the cloud proxy refuses Actions
 * variables), so it fires `supervisor-tick.yml`, which reads it in Actions
 * and wakes the routine with a proper payload. The dispatcher wakes it on
 * urgent events in between (`wakeSupervisor` in dispatch.ts).
 */

import type { SupervisorWake } from './dispatch.ts';

export interface TickFacts {
  /** The kill switch is on (`isPaused`). */
  paused: boolean;
  /** The harness supervisor routine's URL and token secrets are set. */
  configured: boolean;
}

export interface TickDecision {
  /** The routine's payload, when it fires. */
  fire?: SupervisorWake;
  /** What it did and why, for the step summary. */
  note: string;
}

/**
 * Fire the harness supervisor with no reasons, unless the kill switch is on
 * or the routine isn't set up. The run decides what needs doing.
 */
export function tick(facts: TickFacts): TickDecision {
  if (facts.paused) {
    return { note: '**Paused:** `AGENTS_PAUSED` is on, so nothing was fired.' };
  }
  if (!facts.configured) {
    return {
      note: "The harness supervisor isn't configured yet (the ROUTINE_HARNESS_SUPERVISOR_URL and _TOKEN secrets aren't set; see docs/agents/cloud-routines.md), so nothing was fired.",
    };
  }
  return {
    fire: { skill: 'supervise', paused: false, reasons: [] },
    note: 'Firing the harness supervisor for its hourly run.',
  };
}
