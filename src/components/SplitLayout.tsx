import { type ReactNode, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../hooks/useTheme';

const SLIDE_DURATION = 350;
const SLIDE_EASING = Easing.out(Easing.cubic);
const CONTENT_FADE_DURATION = 500;

interface SplitLayoutProps {
  /** Main content (left pane, ~2/3 width) */
  main: ReactNode;
  /** Side panel content (right pane, ~1/3 width). When null, main takes full width. */
  panel: ReactNode | null;
  /** Lightweight placeholder shown inside the panel during the enter animation. */
  panelPlaceholder?: ReactNode;
  /** When false, panel show/hide is instant (no animation). Default true. */
  animate?: boolean;
}

export function SplitLayout({ main, panel, panelPlaceholder, animate = true }: SplitLayoutProps) {
  const { colors } = useTheme();
  const hasPanel = panel !== null;
  const panelProgress = useSharedValue(hasPanel ? 1 : 0);
  const contentOpacity = useSharedValue(hasPanel ? 1 : 0);

  // Keep a ref to the last non-null panel so we can render it during exit animation
  const lastPanelRef = useRef<ReactNode>(null);
  const [renderPanel, setRenderPanel] = useState(hasPanel);
  // Defer panel content until enter animation completes to avoid heavy
  // component mounting (FlashList, CachedImage, etc.) during the layout change.
  const [panelReady, setPanelReady] = useState(hasPanel);

  // Generation token gates stale timer callbacks. Each enter/exit cycle bumps
  // the counter; timeouts compare their captured ID against the current ref
  // and bail when a newer cycle has started. Prevents the rare race where
  // rapid show/hide toggles within SLIDE_DURATION (350ms) leave panelReady
  // desync'd from renderPanel.
  const transitionIdRef = useRef(0);

  if (panel !== null) {
    lastPanelRef.current = panel;
  }

  useEffect(() => {
    const id = ++transitionIdRef.current;
    if (hasPanel) {
      setRenderPanel(true);
      cancelAnimation(panelProgress);
      cancelAnimation(contentOpacity);
      if (animate) {
        setPanelReady(false);
        contentOpacity.value = 0;
        panelProgress.value = withTiming(1, {
          duration: SLIDE_DURATION,
          easing: SLIDE_EASING,
        });
        // Drive panelReady from a JS-side timer rather than the worklet
        // completion callback. The Reanimated callback fires with
        // finished=false whenever the animation is cancelled — which
        // happens any time this effect re-runs while the animation is in
        // flight (e.g. when `showPanel` briefly flickers during a track
        // change because `hasCurrentTrack || queueLoading` transitions).
        // Relying on the callback could leave panelReady stranded at
        // false and strand the placeholder gradient forever.
        const timer = setTimeout(() => {
          if (transitionIdRef.current === id) setPanelReady(true);
        }, SLIDE_DURATION);
        return () => clearTimeout(timer);
      } else {
        panelProgress.value = 1;
        setPanelReady(true);
        contentOpacity.value = 1;
      }
    } else {
      cancelAnimation(panelProgress);
      cancelAnimation(contentOpacity);
      if (animate) {
        // Fade out content and divider in parallel; unmount when done
        contentOpacity.value = withTiming(0, {
          duration: SLIDE_DURATION,
          easing: SLIDE_EASING,
        });
        panelProgress.value = withTiming(0, {
          duration: SLIDE_DURATION,
          easing: SLIDE_EASING,
        });
        const timer = setTimeout(() => {
          if (transitionIdRef.current !== id) return;
          setRenderPanel(false);
          setPanelReady(false);
        }, SLIDE_DURATION);
        return () => clearTimeout(timer);
      } else {
        panelProgress.value = 0;
        contentOpacity.value = 0;
        setRenderPanel(false);
        setPanelReady(false);
      }
    }
  }, [hasPanel, animate, panelProgress, contentOpacity]);

  // Fade in panel content after the enter animation completes
  useEffect(() => {
    if (panelReady && hasPanel) {
      contentOpacity.value = withTiming(1, {
        duration: CONTENT_FADE_DURATION,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [panelReady, hasPanel, contentOpacity]);

  const dividerStyle = useAnimatedStyle(() => ({
    opacity: panelProgress.value,
    width: panelProgress.value > 0 ? StyleSheet.hairlineWidth : 0,
  }));

  const contentStyle = useAnimatedStyle(() => ({
    flex: 1,
    opacity: contentOpacity.value,
    transform: [
      { translateX: (1 - contentOpacity.value) * 20 },
      { scale: 0.97 + contentOpacity.value * 0.03 },
    ],
  }));

  // Show content when panel is ready (enter complete) or during exit animation
  const showContent = panelReady || !hasPanel;

  return (
    <View style={styles.container}>
      <View style={styles.main}>{main}</View>
      {renderPanel && (
        <>
          <Animated.View style={[{ backgroundColor: colors.border }, dividerStyle]} />
          <View style={[styles.panel, { backgroundColor: colors.background }]}>
            {showContent ? (
              <Animated.View style={contentStyle}>
                {panel ?? lastPanelRef.current}
              </Animated.View>
            ) : panelPlaceholder ?? null}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
  },
  main: {
    flex: 3,
  },
  panel: {
    flex: 1,
  },
});
