import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LayoutRectangle } from 'react-native';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

type Point = { x: number; y: number; at: number };
type Direction = { x: number; y: number };

interface SwipeAttackLayerProps {
  enabled: boolean;
  target: LayoutRectangle | null;
  onHit: () => void;
}

const MAX_POINTS = 30;
const MIN_FIRST_SLASH_DISTANCE = 50;
const MIN_REARM_DISTANCE = 50;
const MIN_REVERSE_DISTANCE = 36;
const MIN_REVERSE_PREP_DISTANCE = 45;
const MIN_ATTACK_SPEED = 250;
const HIT_COOLDOWN_MS = 110;
const HIT_SLOP = 24;
const REVERSE_DOT_THRESHOLD = Math.cos((100 * Math.PI) / 180);

function pointInsideTarget(point: Point, target: LayoutRectangle): boolean {
  return point.x >= target.x - HIT_SLOP
    && point.x <= target.x + target.width + HIT_SLOP
    && point.y >= target.y - HIT_SLOP
    && point.y <= target.y + target.height + HIT_SLOP;
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return abC * abD <= 0 && cdA * cdB <= 0;
}

/** Fast swipes can jump from one side of the monster to the other between samples. */
function segmentIntersectsTarget(a: Point, b: Point, target: LayoutRectangle): boolean {
  if (pointInsideTarget(a, target) || pointInsideTarget(b, target)) return true;
  const left = target.x - HIT_SLOP;
  const right = target.x + target.width + HIT_SLOP;
  const top = target.y - HIT_SLOP;
  const bottom = target.y + target.height + HIT_SLOP;
  const topLeft = { x: left, y: top, at: 0 };
  const topRight = { x: right, y: top, at: 0 };
  const bottomLeft = { x: left, y: bottom, at: 0 };
  const bottomRight = { x: right, y: bottom, at: 0 };
  return segmentsIntersect(a, b, topLeft, topRight)
    || segmentsIntersect(a, b, topRight, bottomRight)
    || segmentsIntersect(a, b, bottomRight, bottomLeft)
    || segmentsIntersect(a, b, bottomLeft, topLeft);
}

function smoothDirection(points: Point[], next: Point): Direction | null {
  const anchor = points[Math.max(0, points.length - 4)];
  if (!anchor) return null;
  const dx = next.x - anchor.x;
  const dy = next.y - anchor.y;
  const length = Math.hypot(dx, dy);
  if (length < 4) return null;
  return { x: dx / length, y: dy / length };
}

function directionDot(a: Direction | null, b: Direction | null): number {
  if (!a || !b) return 1;
  return a.x * b.x + a.y * b.y;
}

function trailPath(points: Point[]): string {
  if (points.length < 2) return '';
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const midpointX = (points[i].x + points[i + 1].x) / 2;
    const midpointY = (points[i].y + points[i + 1].y) / 2;
    path += ` Q ${points[i].x} ${points[i].y} ${midpointX} ${midpointY}`;
  }
  const last = points[points.length - 1];
  path += ` L ${last.x} ${last.y}`;
  return path;
}

/**
 * Fruit-Ninja-style continuous slash input. A held gesture may land many
 * attacks, but only after a real return pass or a deliberate reversal.
 */
export function SwipeAttackLayer({ enabled, target, onHit }: SwipeAttackLayerProps) {
  const [points, setPoints] = useState<Point[]>([]);
  const [impactPoint, setImpactPoint] = useState<Point | null>(null);
  const pointsRef = useRef<Point[]>([]);
  const initialDistanceRef = useRef(0);
  const distanceSinceHitRef = useRef(0);
  const reverseDistanceRef = useRef(0);
  const hasHitRef = useRef(false);
  const hasExitedSinceHitRef = useRef(false);
  const reversingRef = useRef(false);
  const lastHitAtRef = useRef(0);
  const lastHitDirectionRef = useRef<Direction | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const impactTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opacity = useSharedValue(0);

  useEffect(() => () => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    if (impactTimerRef.current) clearTimeout(impactTimerRef.current);
  }, []);

  const showImpact = useCallback((point: Point) => {
    setImpactPoint(point);
    if (impactTimerRef.current) clearTimeout(impactTimerRef.current);
    impactTimerRef.current = setTimeout(() => {
      impactTimerRef.current = null;
      setImpactPoint(null);
    }, 130);
  }, []);

  const registerHit = useCallback((point: Point, direction: Direction | null, inside: boolean) => {
    hasHitRef.current = true;
    lastHitAtRef.current = point.at;
    lastHitDirectionRef.current = direction;
    initialDistanceRef.current = 0;
    distanceSinceHitRef.current = 0;
    reverseDistanceRef.current = 0;
    reversingRef.current = false;
    hasExitedSinceHitRef.current = !inside;
    showImpact(point);
    onHit();
  }, [onHit, showImpact]);

  const clearSoon = useCallback(() => {
    opacity.value = withTiming(0, { duration: 210 });
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => {
      clearTimerRef.current = null;
      pointsRef.current = [];
      setPoints([]);
      setImpactPoint(null);
    }, 220);
  }, [opacity]);

  const begin = useCallback((x: number, y: number) => {
    if (!enabled) return;
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    const first = { x, y, at: Date.now() };
    pointsRef.current = [first];
    initialDistanceRef.current = 0;
    distanceSinceHitRef.current = 0;
    reverseDistanceRef.current = 0;
    hasHitRef.current = false;
    hasExitedSinceHitRef.current = false;
    reversingRef.current = false;
    lastHitAtRef.current = 0;
    lastHitDirectionRef.current = null;
    opacity.value = 1;
    setPoints([first]);
    setImpactPoint(null);
  }, [enabled, opacity]);

  const move = useCallback((x: number, y: number, velocityX: number, velocityY: number) => {
    if (!enabled) return;
    const previous = pointsRef.current[pointsRef.current.length - 1];
    if (!previous) return;
    const now = Date.now();
    const nextPoint = { x, y, at: now };
    const distance = Math.hypot(x - previous.x, y - previous.y);
    if (distance < 2) return;

    const direction = smoothDirection(pointsRef.current, nextPoint);
    const sampledSpeed = distance / Math.max(1, now - previous.at) * 1000;
    const speed = Math.max(sampledSpeed, Math.hypot(velocityX, velocityY));
    const inside = target ? pointInsideTarget(nextPoint, target) : false;
    const intersects = target ? segmentIntersectsTarget(previous, nextPoint, target) : false;
    const nextPoints = [...pointsRef.current, nextPoint].slice(-MAX_POINTS);
    pointsRef.current = nextPoints;
    setPoints(nextPoints);

    if (!target) return;

    if (!hasHitRef.current) {
      initialDistanceRef.current += distance;
      if (
        intersects
        && initialDistanceRef.current >= MIN_FIRST_SLASH_DISTANCE
        && speed >= MIN_ATTACK_SPEED
      ) {
        registerHit(nextPoint, direction, inside);
      }
      return;
    }

    distanceSinceHitRef.current += distance;
    const cooledDown = now - lastHitAtRef.current >= HIT_COOLDOWN_MS;
    const returnedThroughTarget = hasExitedSinceHitRef.current
      && intersects
      && distanceSinceHitRef.current >= MIN_REARM_DISTANCE;

    if (!hasExitedSinceHitRef.current) {
      const reversed = directionDot(direction, lastHitDirectionRef.current) <= REVERSE_DOT_THRESHOLD;
      if (reversed && distanceSinceHitRef.current >= MIN_REVERSE_PREP_DISTANCE) {
        if (!reversingRef.current) {
          reversingRef.current = true;
          reverseDistanceRef.current = 0;
        } else {
          reverseDistanceRef.current += distance;
        }
      } else if (!reversed) {
        reversingRef.current = false;
        reverseDistanceRef.current = 0;
      }
    }

    const completedInsideReversal = reversingRef.current
      && reverseDistanceRef.current >= MIN_REVERSE_DISTANCE
      && intersects;

    if (
      cooledDown
      && speed >= MIN_ATTACK_SPEED
      && (returnedThroughTarget || completedInsideReversal)
    ) {
      registerHit(nextPoint, direction, inside);
      return;
    }

    // Set this after evaluating the current segment so merely leaving the
    // monster cannot count as the next return pass.
    if (!inside) hasExitedSinceHitRef.current = true;
  }, [enabled, registerHit, target]);

  const gesture = useMemo(
    () => Gesture.Pan()
      .enabled(enabled)
      .minDistance(1)
      .runOnJS(true)
      .onBegin((event) => begin(event.x, event.y))
      .onUpdate((event) => move(event.x, event.y, event.velocityX, event.velocityY))
      .onFinalize(clearSoon),
    [begin, clearSoon, enabled, move],
  );

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const path = trailPath(points);
  const last = points[points.length - 1] ?? null;

  return (
    <GestureDetector gesture={gesture}>
      <View
        collapsable={false}
        pointerEvents={enabled ? 'box-only' : 'none'}
        accessible={enabled}
        accessibilityRole="button"
        accessibilityLabel="Attack the monster"
        accessibilityHint="Swipe back and forth across the monster to lower its negative power."
        onAccessibilityTap={() => {
          if (enabled) onHit();
        }}
        style={[StyleSheet.absoluteFill, styles.layer]}
      >
        <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]} pointerEvents="none">
          <Svg width="100%" height="100%">
            {path ? (
              <Path
                d={path}
                fill="none"
                stroke="#ff5a1f"
                strokeOpacity={0.34}
                strokeWidth={20}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}

            {points.slice(1).map((point, index) => {
              const previous = points[index];
              const progress = (index + 1) / Math.max(1, points.length - 1);
              const isHead = progress > 0.76;
              return (
                <Path
                  key={`${point.at}-${index}`}
                  d={`M ${previous.x} ${previous.y} L ${point.x} ${point.y}`}
                  fill="none"
                  stroke={isHead ? '#FFFFFF' : '#ff7a1a'}
                  strokeOpacity={0.12 + progress * 0.88}
                  strokeWidth={2 + progress * 9}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            })}

            {last ? (
              <>
                <Circle cx={last.x} cy={last.y} r={14} fill="#ff7a1a" fillOpacity={0.24} />
                <Circle cx={last.x} cy={last.y} r={6} fill="#FFFFFF" fillOpacity={0.94} />
              </>
            ) : null}

            {impactPoint ? (
              <>
                <Circle cx={impactPoint.x} cy={impactPoint.y} r={24} fill="#ff7a1a" fillOpacity={0.26} />
                <Circle cx={impactPoint.x} cy={impactPoint.y} r={12} fill="#FFFFFF" fillOpacity={0.88} />
              </>
            ) : null}
          </Svg>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  layer: { zIndex: 20, backgroundColor: 'transparent' },
});
