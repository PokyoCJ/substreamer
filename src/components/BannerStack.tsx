/**
 * Priority-aware container for the top-of-screen pill banners. At most ONE
 * banner is shown at a time; the highest-priority banner with an active state
 * wins and suppresses the others.
 *
 * Ladder (highest priority first — matches the plan document):
 *   1. Persistence degraded (PersistenceDegradedBanner) — sticky session-long
 *      signal that writes won't survive relaunch; user MUST know about it
 *      even if connectivity is also broken
 *   2. SSL-error / network-unreachable / reconnected (ConnectivityBanner)
 *   3. Storage full (StorageFullBanner)
 *   4. Library-sync error variants: paused-auth-error, paused-metered, error
 *      (LibrarySyncBanner — actionable failures rank above a plain offline
 *      state so users see "reauthenticate" before "offline")
 *   5. (reserved — no connectivity "offline" variant exists today;
 *      ConnectivityBanner hides itself when the user enables offline mode)
 *   6. Library-sync progress / paused-offline variants (LibrarySyncBanner)
 *   7. Image-cache refresh progress (ImageCacheBanner) — transient
 *      user-initiated cover-art refresh cycle; ranks below library-sync
 *      progress because metadata catch-up is the higher-priority signal
 */

import { memo } from 'react';

import { ConnectivityBanner } from './ConnectivityBanner';
import { FailoverBanner } from './FailoverBanner';
import { ImageCacheBanner } from './ImageCacheBanner';
import { LibrarySyncBanner } from './LibrarySyncBanner';
import { PersistenceDegradedBanner } from './PersistenceDegradedBanner';
import { StorageFullBanner } from './StorageFullBanner';
import { connectivityStore } from '../store/connectivityStore';
import { failoverStatusStore } from '../store/failoverStatusStore';
import { imageDownloadQueueStore } from '../store/imageDownloadQueueStore';
import { offlineModeStore } from '../store/offlineModeStore';
import { isDbHealthy } from '../store/persistence';
import { storageLimitStore } from '../store/storageLimitStore';
import { syncStatusStore } from '../store/syncStatusStore';

const FAILOVER_BANNER_WINDOW_MS = 4_000;

export const BannerStack = memo(function BannerStack() {
  const bannerState = connectivityStore((s) => s.bannerState);
  const offlineMode = offlineModeStore((s) => s.offlineMode);
  const isStorageFull = storageLimitStore((s) => s.isStorageFull);
  const syncPhase = syncStatusStore((s) => s.detailSyncPhase);
  const imageQueueCycleId = imageDownloadQueueStore((s) => s.cycleId);
  const imageQueueTotal = imageDownloadQueueStore((s) => s.cycleTotal);
  const lastFailoverAt = failoverStatusStore((s) => s.lastSwitchAt);
  const lastFailoverCause = failoverStatusStore((s) => s.lastSwitchCause);

  // Persistence-degraded is sticky and captured at module load. If SQLite
  // failed to open, surface this above everything else so the user knows
  // settings/login won't persist.
  if (!isDbHealthy()) return <PersistenceDegradedBanner />;

  // Failover banner is transient (~4s) and takes priority over connectivity
  // banners while it shows — the failover IS the resolution of the
  // connectivity issue that just tripped the unreachable banner. Manual
  // switches don't trigger the banner (the user knows; they tapped).
  const failoverRecent =
    lastFailoverAt != null
    && lastFailoverCause === 'auto'
    && Date.now() - lastFailoverAt < FAILOVER_BANNER_WINDOW_MS;
  if (failoverRecent) return <FailoverBanner />;

  // ConnectivityBanner internally hides itself when offlineMode is true (see
  // ConnectivityBanner.tsx:62). Mirror that logic here so the priority
  // ladder doesn't needlessly block lower-priority banners.
  const connectivityShowing = bannerState !== 'hidden' && !offlineMode;

  if (connectivityShowing) return <ConnectivityBanner />;
  if (isStorageFull) return <StorageFullBanner />;

  // Library-sync: error/paused-auth/paused-metered rank above plain offline.
  // Currently functionally equivalent to the progress variant (they all
  // render <LibrarySyncBanner />) but structured explicitly so that a
  // future connectivity "offline" variant can be inserted between them.
  const isSyncError =
    syncPhase === 'error'
    || syncPhase === 'paused-auth-error'
    || syncPhase === 'paused-metered';
  if (isSyncError) return <LibrarySyncBanner />;

  if (syncPhase === 'syncing' || syncPhase === 'paused-offline') {
    return <LibrarySyncBanner />;
  }

  if (imageQueueCycleId !== null && imageQueueTotal > 0) {
    return <ImageCacheBanner />;
  }
  return null;
});
