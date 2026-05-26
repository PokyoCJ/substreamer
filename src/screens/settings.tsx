import Ionicons from "@react-native-vector-icons/ionicons/static";
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../hooks/useTheme';
import { devOptionsStore } from '../store/devOptionsStore';
import { onboardingStore } from '../store/onboardingStore';
import { searchStore } from '../store/searchStore';
import { processingOverlayStore } from '../store/processingOverlayStore';
import { selectionAsync, notificationAsync } from '../utils/haptics';

import type { IoniconsName } from '../utils/iconNames';
const APP_VERSION = Constants.expoConfig?.version ?? '?';
const BUILD_NUMBER =
  Platform.OS === 'ios'
    ? Constants.expoConfig?.ios?.buildNumber
    : String((Constants.expoConfig?.android?.versionCode ?? 0) % 1000);


const SETTINGS_LINKS: {
  route: string;
  labelKey: string;
  subtitleKey: string;
  icon: IoniconsName;
}[] = [
  { route: '/settings-server', labelKey: 'serverAccount', subtitleKey: 'serverAccountSubtitle', icon: 'server-outline' },
  { route: '/settings-appearance', labelKey: 'appearanceLayout', subtitleKey: 'appearanceLayoutSubtitle', icon: 'color-palette-outline' },
  { route: '/settings-playback', labelKey: 'soundPlayback', subtitleKey: 'soundPlaybackSubtitle', icon: 'musical-notes-outline' },
  { route: '/settings-connectivity', labelKey: 'connectivity', subtitleKey: 'connectivitySubtitle', icon: 'globe-outline' },
  { route: '/settings-storage', labelKey: 'storage', subtitleKey: 'storageSubtitle', icon: 'folder-outline' },
  { route: '/settings-library-data', labelKey: 'libraryData', subtitleKey: 'libraryDataSubtitle', icon: 'library-outline' },
];

const DEV_SETTINGS_LINKS: typeof SETTINGS_LINKS = [
  { route: '/file-explorer', labelKey: 'fileExplorer', subtitleKey: 'fileExplorerSubtitle', icon: 'document-text-outline' },
  { route: '/logging', labelKey: 'logging', subtitleKey: 'loggingSubtitle', icon: 'list-outline' },
];

const TAP_WINDOW_MS = 3000;
const TAP_COUNT_TO_ACTIVATE = 5;

export function SettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const headerHeight = searchStore((s) => s.headerHeight);
  const devEnabled = devOptionsStore((s) => s.enabled);

  const tapTimestamps = useRef<number[]>([]);
  const countdownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [countdownText, setCountdownText] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (countdownTimer.current) clearTimeout(countdownTimer.current);
    };
  }, []);

  const handleVersionTap = useCallback(() => {
    if (devEnabled) return;

    const now = Date.now();
    tapTimestamps.current.push(now);
    tapTimestamps.current = tapTimestamps.current.filter((t) => now - t < TAP_WINDOW_MS);

    const count = tapTimestamps.current.length;
    const remaining = TAP_COUNT_TO_ACTIVATE - count;

    if (countdownTimer.current) clearTimeout(countdownTimer.current);

    if (remaining <= 0) {
      tapTimestamps.current = [];
      setCountdownText(null);
      devOptionsStore.getState().enable();
      notificationAsync();
      processingOverlayStore.getState().showSuccess(t('developerOptionsActivated'));
    } else if (count >= 2) {
      selectionAsync();
      setCountdownText(t('devOptionsTapCountdown', { count: remaining }));
      countdownTimer.current = setTimeout(() => setCountdownText(null), TAP_WINDOW_MS);
    }
  }, [devEnabled, t]);

  const handleShowOnboarding = useCallback(() => {
    onboardingStore.getState().reset();
    onboardingStore.getState().show();
  }, []);

  const visibleLinks = useMemo(() => {
    return devEnabled ? [...SETTINGS_LINKS, ...DEV_SETTINGS_LINKS] : SETTINGS_LINKS;
  }, [devEnabled]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: headerHeight + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      {visibleLinks.map((link) => (
        <Pressable
          key={link.route}
          onPress={() => router.push(link.route as never)}
          style={({ pressed }) => [
            styles.navRow,
            { backgroundColor: colors.card },
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.navRowLeft}>
            <Ionicons name={link.icon} size={20} color={colors.primary} style={styles.navRowIcon} />
            <View style={styles.navRowText}>
              <Text style={[styles.navRowLabel, { color: colors.textPrimary }]}>
                {t(link.labelKey)}
              </Text>
              <Text style={[styles.navRowSubtitle, { color: colors.textSecondary }]}>
                {t(link.subtitleKey)}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </Pressable>
      ))}
      <Pressable
        onPress={handleShowOnboarding}
        style={({ pressed }) => [
          styles.navRow,
          { backgroundColor: colors.card },
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.navRowLeft}>
          <Ionicons name="help-circle-outline" size={20} color={colors.primary} style={styles.navRowIcon} />
          <View style={styles.navRowText}>
            <Text style={[styles.navRowLabel, { color: colors.textPrimary }]}>
              {t('helpWelcomeGuide')}
            </Text>
            <Text style={[styles.navRowSubtitle, { color: colors.textSecondary }]}>
              {t('helpWelcomeGuideSubtitle')}
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </Pressable>
      <Pressable onPress={handleVersionTap}>
        <Text style={[styles.versionText, { color: colors.textSecondary }]}>
          {countdownText ?? t('versionText', { version: APP_VERSION, build: BUILD_NUMBER })}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  navRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  navRowIcon: {
    marginTop: 2,
    alignSelf: 'flex-start',
  },
  navRowText: {
    flex: 1,
  },
  navRowLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  navRowSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  pressed: {
    opacity: 0.8,
  },
  versionText: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 20,
  },
});
