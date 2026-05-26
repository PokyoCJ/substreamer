import { Alert, Platform } from 'react-native';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { themedAlertStore } from '../store/themedAlertStore';

interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

/**
 * Platform-aware alert hook.
 *
 * - iOS: delegates to the native `Alert.alert` (respects system dark mode).
 * - Android: routes through the global `themedAlertStore` so the alert
 *   Modal mounts at the root layout (via `ThemedAlertHost`), independent
 *   of whatever component triggered it. This avoids Android Modal
 *   handoff races when an alert is opened immediately after another
 *   Modal closes (e.g. MoreOptionsSheet → Delete Playlist confirm).
 */
export function useThemedAlert() {
  const { t } = useTranslation();

  const alert = useCallback(
    (title: string, message?: string, buttons?: AlertButton[]) => {
      const resolvedButtons = buttons ?? [{ text: t('ok'), style: 'default' as const }];

      if (Platform.OS === 'ios') {
        Alert.alert(title, message, resolvedButtons);
        return;
      }

      themedAlertStore.getState().show(title, message, resolvedButtons);
    },
    [t],
  );

  return { alert };
}
