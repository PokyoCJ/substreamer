import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { kvStorage } from './persistence';

/**
 * Tracks the post-Migration-22 cover-art recache pass.
 *
 * Migration 22 reconciles `cached_images` rows + on-disk dirs to the
 * full server-issued cover-art IDs. After it completes, this store is
 * left in `pending` so an online worker can walk every downloaded
 * album/playlist and fetch fresh server art under the new canonical
 * IDs. The worker is also the back-end for the manual "Refresh
 * downloaded cover art" entry in Settings → Storage.
 *
 *   - `auto`  trigger: only fires when `status !== 'done'`. Runs once.
 *   - `manual` trigger: resets state to pending and runs again.
 */

export type CoverArtRecacheStatus = 'pending' | 'running' | 'done';

export interface CoverArtRecacheState {
  status: CoverArtRecacheStatus;
  total: number;
  processed: number;
  failed: number;
  lastRunAt: number | null;
  /** Identifier of the last trigger source; for diagnostics only. */
  lastTrigger: 'auto' | 'manual' | null;

  begin: (total: number, trigger: 'auto' | 'manual') => void;
  recordProcessed: () => void;
  recordFailed: () => void;
  complete: () => void;
  /** Reset to a fresh `pending` state — used by Migration 22 and the
   *  manual settings button. */
  reset: () => void;
}

export const coverArtRecacheStore = create<CoverArtRecacheState>()(
  persist(
    (set) => ({
      status: 'pending',
      total: 0,
      processed: 0,
      failed: 0,
      lastRunAt: null,
      lastTrigger: null,

      begin: (total, trigger) =>
        set({
          status: 'running',
          total,
          processed: 0,
          failed: 0,
          lastTrigger: trigger,
        }),

      recordProcessed: () =>
        set((s) => ({ processed: s.processed + 1 })),

      recordFailed: () =>
        set((s) => ({ failed: s.failed + 1, processed: s.processed + 1 })),

      complete: () =>
        set({ status: 'done', lastRunAt: Date.now() }),

      reset: () =>
        set({
          status: 'pending',
          total: 0,
          processed: 0,
          failed: 0,
        }),
    }),
    {
      name: 'substreamer-cover-art-recache',
      storage: createJSONStorage(() => kvStorage),
      partialize: (state) => ({
        status: state.status,
        total: state.total,
        processed: state.processed,
        failed: state.failed,
        lastRunAt: state.lastRunAt,
        lastTrigger: state.lastTrigger,
      }),
    },
  ),
);
