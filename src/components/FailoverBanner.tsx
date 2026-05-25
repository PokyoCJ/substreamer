/**
 * Transient banner shown for ~3.5s after an automatic server-failover
 * switch. Pure status surface — driven by `failoverStatusStore`'s
 * `lastSwitchAt` timestamp; a fresh timestamp re-triggers the banner.
 *
 * Manual switches don't surface a banner (the user knows — they tapped
 * the Switch button themselves). Auto switches DO so the user can tell
 * why their music stuttered briefly on a flaky network.
 *
 * Visual language matches `LibrarySyncBanner` / `ImageCacheBanner` —
 * dark capsule centred below the header.
 */

import Ionicons from '@react-native-vector-icons/ionicons/static';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { failoverStatusStore } from '../store/failoverStatusStore';

const CAPSULE_HEIGHT = 44;
const CAPSULE_BORDER_RADIUS = CAPSULE_HEIGHT / 2;
export const BANNER_HEIGHT = CAPSULE_HEIGHT + 8;

const SPRING_CONFIG = { damping: 14, stiffness: 200, mass: 0.8 };
const EXPAND_MS = 300;
const COLLAPSE_MS = 280;
const SHRINK_MS = 300;
const SHRINK_EASING = Easing.in(Easing.cubic);
const LAYOUT_EASING = Easing.inOut(Easing.cubic);

const ACCENT_BLUE = '#1D9BF0';
const DISPLAY_MS = 3_500;

export const FailoverBanner = memo(function FailoverBanner() {
  const { t } = useTranslation();
  const lastSwitchAt = failoverStatusStore((s) => s.lastSwitchAt);
  const lastSwitchTarget = failoverStatusStore((s) => s.lastSwitchTarget);
  const lastSwitchCause = failoverStatusStore((s) => s.lastSwitchCause);

  // Local visibility derived from "did we just receive an auto switch?".
  // The store keeps the lastSwitchAt timestamp permanently for inspection;
  // the banner only surfaces it for DISPLAY_MS after the switch landed.
  const [visible, setVisible] = useState(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (lastSwitchAt == null || lastSwitchCause !== 'auto') return;
    setVisible(true);
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => setVisible(false), DISPLAY_MS);
    return () => {
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
    };
  }, [lastSwitchAt, lastSwitchCause]);

  const prevVisible = useRef(visible);
  const heightValue = useSharedValue(visible ? BANNER_HEIGHT : 0);
  const capsuleScale = useSharedValue(visible ? 1 : 0);
  const capsuleOpacity = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    if (visible && !prevVisible.current) {
      heightValue.value = withTiming(BANNER_HEIGHT, { duration: EXPAND_MS, easing: LAYOUT_EASING });
      capsuleOpacity.value = withDelay(80, withTiming(1, { duration: 150 }));
      capsuleScale.value = withDelay(80, withSpring(1, SPRING_CONFIG));
    } else if (!visible && prevVisible.current) {
      capsuleScale.value = withTiming(0, { duration: SHRINK_MS, easing: SHRINK_EASING });
      capsuleOpacity.value = withTiming(0, { duration: SHRINK_MS - 50 });
      heightValue.value = withDelay(
        SHRINK_MS - 80,
        withTiming(0, { duration: COLLAPSE_MS, easing: LAYOUT_EASING }),
      );
    }
    prevVisible.current = visible;
  }, [visible, heightValue, capsuleScale, capsuleOpacity]);

  const containerStyle = useAnimatedStyle(() => ({
    height: heightValue.value,
  }));

  const capsuleStyle = useAnimatedStyle(() => ({
    opacity: capsuleOpacity.value,
    transform: [
      { scaleX: capsuleScale.value },
      { scaleY: capsuleScale.value },
    ],
  }));

  if (!visible) return null;

  const label = lastSwitchTarget === 'secondary'
    ? t('switchedToSecondary')
    : t('switchedToPrimary');

  return (
    <Animated.View style={[styles.outer, containerStyle]}>
      <View style={styles.pillContainer}>
        <Animated.View style={[styles.capsule, capsuleStyle]}>
          <Ionicons name="swap-horizontal" size={16} color={ACCENT_BLUE} />
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  outer: {
    overflow: 'hidden',
  },
  pillContainer: {
    height: BANNER_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    borderRadius: CAPSULE_BORDER_RADIUS,
    height: CAPSULE_HEIGHT,
    paddingHorizontal: 20,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  label: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
