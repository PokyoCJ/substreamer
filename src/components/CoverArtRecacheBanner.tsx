/**
 * Persistent banner shown while the post-Migration-22 cover-art recache
 * pass is running. Modelled on `DownloadBanner` so it stacks naturally
 * with the other top-of-tabs banners.
 *
 * Visible only when `coverArtRecacheStore.status === 'running'`.
 * Non-interactive — the manual entry point lives in Settings → Storage.
 */

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../hooks/useTheme';
import { coverArtRecacheStore } from '../store/coverArtRecacheStore';

export const RECACHE_BANNER_HEIGHT = 44;
const EXPAND_MS = 300;
const COLLAPSE_MS = 280;
const COLLAPSE_DELAY_MS = 60;
const CONTENT_FADE_IN_MS = 200;
const CONTENT_FADE_OUT_MS = 150;

export function CoverArtRecacheBanner() {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const status = coverArtRecacheStore((s) => s.status);
  const total = coverArtRecacheStore((s) => s.total);
  const processed = coverArtRecacheStore((s) => s.processed);

  const visible = status === 'running' && total > 0;

  const prevVisible = useRef(false);
  const heightValue = useSharedValue(0);
  const contentOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible && !prevVisible.current) {
      heightValue.value = withTiming(RECACHE_BANNER_HEIGHT, {
        duration: EXPAND_MS,
        easing: Easing.inOut(Easing.cubic),
      });
      contentOpacity.value = withDelay(80, withTiming(1, { duration: CONTENT_FADE_IN_MS }));
    } else if (!visible && prevVisible.current) {
      contentOpacity.value = withTiming(0, { duration: CONTENT_FADE_OUT_MS });
      heightValue.value = withDelay(
        COLLAPSE_DELAY_MS,
        withTiming(0, { duration: COLLAPSE_MS, easing: Easing.inOut(Easing.cubic) }),
      );
    }
    prevVisible.current = visible;
  }, [visible, heightValue, contentOpacity]);

  const containerStyle = useAnimatedStyle(() => ({
    height: heightValue.value,
  }));

  const contentAnimStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
  }));

  const progress = total === 0 ? 0 : Math.min(1, processed / total);
  const countText = total > 0 ? `${processed}/${total}` : '';

  return (
    <Animated.View style={[styles.container, { backgroundColor: colors.card }, containerStyle]}>
      <Animated.View style={[styles.inner, contentAnimStyle]}>
        <View style={styles.content}>
          <Ionicons
            name="refresh-circle"
            size={20}
            color={colors.primary}
            style={styles.icon}
          />
          <Text style={[styles.label, { color: colors.textPrimary }]} numberOfLines={1}>
            {t('coverArtRecacheBannerLabel', 'Updating cover art…')}
          </Text>
          {countText ? (
            <Text style={[styles.countText, { color: colors.textSecondary }]}>
              {countText}
            </Text>
          ) : null}
        </View>
        <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: colors.primary, width: `${Math.round(progress * 100)}%` },
            ]}
          />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  inner: {
    flex: 1,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  icon: {
    marginRight: 8,
  },
  label: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  countText: {
    fontSize: 12,
    marginRight: 6,
  },
  progressTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
  },
  progressFill: {
    height: '100%',
  },
});
