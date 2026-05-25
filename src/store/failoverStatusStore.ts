/**
 * Transient status surface for the most recent server-failover switch.
 * Phase 7's banner subscribes to this for the "Switched to {target}"
 * toast. Lives separately from authStore so the toast trigger is a
 * dedicated signal (a single timestamp change), not coupled to the
 * activeServer prop which can be read frequently.
 */

import { create } from 'zustand';

import { type ServerSlot } from './authStore';

export type SwitchCause = 'manual' | 'auto';

export interface FailoverStatusState {
  /** Slot we just switched TO, or null if no switch since boot. */
  lastSwitchTarget: ServerSlot | null;
  /** What triggered the switch — manual user action vs auto failover. */
  lastSwitchCause: SwitchCause | null;
  /** Unix ms of the last switch; null if never switched. Banner uses this
   *  as the trigger key — a change means "show the toast again". */
  lastSwitchAt: number | null;

  recordSwitch: (target: ServerSlot, cause: SwitchCause) => void;
}

export const failoverStatusStore = create<FailoverStatusState>()((set) => ({
  lastSwitchTarget: null,
  lastSwitchCause: null,
  lastSwitchAt: null,

  recordSwitch: (target, cause) =>
    set({
      lastSwitchTarget: target,
      lastSwitchCause: cause,
      lastSwitchAt: Date.now(),
    }),
}));
