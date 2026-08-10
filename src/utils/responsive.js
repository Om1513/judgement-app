// The app's one and only place where screen size turns into pixels.
//
// The design was drawn on an iPhone 17 Pro in landscape - 874 x 402 logical
// points - and that layout is the reference. Everything here is built so that
// on a 874 x 402 viewport the scale factor is exactly 1 and every helper is the
// identity function: the baseline device renders byte-identical styles to the
// hand-tuned originals, and only other sizes take a different path.
//
// The strategy is a single UNIFORM scale (never separate x/y factors), so
// nothing is ever stretched - the whole design shrinks or grows as one piece
// and keeps its proportions on any aspect ratio. Where a uniform scale is the
// wrong answer - text, tap targets, the spread of seats across a table that is
// relatively wider than the baseline - there are dedicated helpers:
//
//   scaleValue      uniform, for anything geometric
//   moderateScale   damped, for values that should move but not fully
//   fontValue       damped + clamped, so text never becomes unreadable or huge
//   scaleStyleTree  applies all of the above across a whole StyleSheet object
//
// Components should not do arithmetic on `useWindowDimensions()` themselves.
// They call useResponsive() for numbers and useScaledStyles() for styles.

import { useContext, useMemo } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

// iPhone 17 Pro, landscape. Measured from the layout this app was built
// against: the game table's own numbers only add up on an 874pt-wide viewport
// (see src/utils/tableLayout.js, where the eight-seat top row comes out exactly
// symmetric at this width and at no other).
export const BASE_WIDTH = 874;
export const BASE_HEIGHT = 402;

// Below ~0.65 the design stops being legible however carefully it is scaled,
// and above 1.5 a tablet starts to look like a zoomed phone. Both ends are
// bounds, not targets - almost every real device lands inside them.
export const MIN_SCALE = 0.65;
export const MAX_SCALE = 1.5;

// Type moves at half the rate of the layout and is clamped tighter still.
// Scaling fonts linearly with the viewport is what makes small phones
// unreadable and tablets look like a children's book.
export const FONT_SCALE_FACTOR = 0.5;
export const FONT_MIN_RATIO = 0.8;
export const FONT_MAX_RATIO = 1.3;

// Apple HIG / Material both land here. Visual size may scale below it; the
// touchable area may not.
export const MIN_TOUCH_TARGET = 44;

export const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

/** Bounds a number, tolerating a reversed range. */
export function clamp(value, min, max) {
  if (min > max) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * The uniform scale factor for a viewport.
 *
 * Deliberately `min` of the two axes rather than an average or the width alone:
 * taking the smaller one guarantees a design that fits the baseline also fits
 * here, on any aspect ratio, with the slack showing up as margin rather than as
 * something running off the edge.
 */
export function getScaleFactor(width, height) {
  if (!width || !height) return 1;
  const raw = Math.min(width / BASE_WIDTH, height / BASE_HEIGHT);
  return clamp(raw, MIN_SCALE, MAX_SCALE);
}

/** Uniform scaling. Identity at the baseline. */
export function scaleValue(value, scale) {
  if (typeof value !== "number" || scale === 1) return value;
  return value * scale;
}

/**
 * Damped scaling: moves `factor` of the way from the base value to the fully
 * scaled one. `moderateScale(48, 0.7)` shrinks by 15%, not 30%.
 */
export function moderateScale(value, scale, factor = 0.5) {
  if (typeof value !== "number" || scale === 1) return value;
  return value + (value * scale - value) * factor;
}

/**
 * Font sizing. Damped like moderateScale, then clamped to a narrow band so the
 * smallest phone and the largest tablet both stay in comfortable reading range.
 */
export function fontValue(value, scale) {
  if (typeof value !== "number" || scale === 1) return value;
  const moderated = moderateScale(value, scale, FONT_SCALE_FACTOR);
  return clamp(moderated, value * FONT_MIN_RATIO, value * FONT_MAX_RATIO);
}

/**
 * A tap target that is allowed to look smaller than it behaves. Returns the
 * visual size; pair it with `touchSlop` for the hitSlop that makes up the
 * difference.
 */
export function touchSize(value, scale, min = MIN_TOUCH_TARGET) {
  return Math.max(scaleValue(value, scale), Math.min(value, min));
}

/** Even hitSlop that lifts a visual size up to the minimum tap target. */
export function touchSlop(visualSize, min = MIN_TOUCH_TARGET) {
  const missing = Math.max(0, min - visualSize) / 2;
  const pad = Math.max(6, missing);
  return { top: pad, bottom: pad, left: pad, right: pad };
}

/**
 * Broad device classes. Four of them, all defined by viewport geometry - never
 * by device name - and used only where a fluid rule genuinely cannot express
 * the difference (column counts, content caps).
 */
export function getBreakpoint(width, height) {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (short >= 600) return "tablet";
  if (long >= 900) return "largeLandscapePhone";
  if (long < 700 || short < 375) return "smallLandscapePhone";
  return "normalLandscapePhone";
}

/**
 * How wide readable content is allowed to get. On a phone this is the whole
 * screen; on a tablet it stops the design from being smeared edge to edge.
 */
export function getMaxContentWidth(width, scale) {
  return Math.min(width, BASE_WIDTH * scale);
}

/**
 * An edge offset that respects a device cutout without moving on devices that
 * have none. `max` rather than `+` on purpose: the baseline inset is 0, so this
 * is the identity there, and on a notched phone the control slides just far
 * enough to clear the unsafe strip instead of gaining a double margin.
 */
export function safeOffset(base, inset) {
  return Math.max(base, inset || 0);
}

// ---------------------------------------------------------------------------
// Style scaling
// ---------------------------------------------------------------------------
//
// Rather than every component peppering itself with s(12) calls, a component
// keeps its StyleSheet as a plain object and hands the whole thing over. Keys
// are scaled by what they mean, which is why this is a lookup table and not a
// regex on the key name.

const SCALE_KEYS = new Set([
  "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight",
  "top", "bottom", "left", "right", "start", "end",
  "margin", "marginTop", "marginBottom", "marginLeft", "marginRight",
  "marginHorizontal", "marginVertical", "marginStart", "marginEnd",
  "padding", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight",
  "paddingHorizontal", "paddingVertical", "paddingStart", "paddingEnd",
  "borderRadius", "borderTopLeftRadius", "borderTopRightRadius",
  "borderBottomLeftRadius", "borderBottomRightRadius",
  "borderTopStartRadius", "borderTopEndRadius",
  "borderBottomStartRadius", "borderBottomEndRadius",
  "gap", "rowGap", "columnGap",
  "shadowRadius", "textShadowRadius",
  "translateX", "translateY",
]);

// Damped, not uniform: type and the space it sits in should stay in proportion
// to each other, so they share the font curve.
const FONT_KEYS = new Set(["fontSize", "lineHeight", "letterSpacing"]);

// Scaled, but never below a hairline - a 1pt gold border that scales to 0.65
// disappears on a low-density screen.
const BORDER_KEYS = new Set([
  "borderWidth", "borderTopWidth", "borderBottomWidth",
  "borderLeftWidth", "borderRightWidth", "borderStartWidth", "borderEndWidth",
]);

const OFFSET_KEYS = new Set(["shadowOffset", "textShadowOffset"]);

function scaleEntry(key, value, scale) {
  if (typeof value === "number") {
    if (SCALE_KEYS.has(key)) return scaleValue(value, scale);
    if (FONT_KEYS.has(key)) return fontValue(value, scale);
    if (BORDER_KEYS.has(key)) {
      const scaled = scaleValue(value, scale);
      return value >= 1 ? Math.max(scaled, 1) : scaled;
    }
    return value;
  }

  if (OFFSET_KEYS.has(key) && value && typeof value === "object") {
    return {
      width: scaleValue(value.width, scale),
      height: scaleValue(value.height, scale),
    };
  }

  if (key === "transform" && Array.isArray(value)) {
    return value.map((entry) => {
      const out = {};
      for (const k of Object.keys(entry)) out[k] = scaleEntry(k, entry[k], scale);
      return out;
    });
  }

  // Percentages, colours, enums, everything else passes through untouched.
  return value;
}

/** Scales one flat style object. */
export function scaleStyle(style, scale) {
  if (!style || scale === 1) return style;
  const out = {};
  for (const key of Object.keys(style)) {
    out[key] = scaleEntry(key, style[key], scale);
  }
  return out;
}

/** Scales a whole `{ name: style }` sheet. */
export function scaleStyleTree(tree, scale) {
  if (scale === 1) return tree;
  const out = {};
  for (const name of Object.keys(tree)) {
    out[name] = scaleStyle(tree[name], scale);
  }
  return out;
}

// One registered StyleSheet per (raw sheet, scale). Keyed off the raw object
// identity, so a component that declares its sheet at module scope - all of
// them do - pays the scaling cost once per distinct viewport size, not once per
// render and not once per instance. This is what keeps PlayedCard and
// PlayerCard cheap when eight of them mount at once.
const sheetCache = new WeakMap();

export function getScaledSheet(rawStyles, scale) {
  let byScale = sheetCache.get(rawStyles);
  if (!byScale) {
    byScale = new Map();
    sheetCache.set(rawStyles, byScale);
  }
  const key = Math.round(scale * 1000);
  let sheet = byScale.get(key);
  if (!sheet) {
    sheet = StyleSheet.create(scaleStyleTree(rawStyles, scale));
    byScale.set(key, sheet);
  }
  return sheet;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Safe-area insets that do not require a provider.
 *
 * `useSafeAreaInsets()` throws when no <SafeAreaProvider> is above it, which
 * would make every shared component untestable in isolation and would crash any
 * screen rendered outside the app shell. Reading the context directly gives the
 * real insets when there is a provider and zeros when there isn't.
 */
export function useInsets() {
  const insets = useContext(SafeAreaInsetsContext);
  return insets || ZERO_INSETS;
}

/**
 * Everything a component needs to know about the viewport, recomputed only when
 * the viewport actually changes.
 *
 * Reactive by construction: useWindowDimensions re-renders on rotation, split
 * screen, a resized browser window or a foldable opening, where a one-off
 * `Dimensions.get()` at module scope would be stale forever.
 */
export function useResponsive() {
  const { width, height } = useWindowDimensions();
  const insets = useInsets();

  return useMemo(() => {
    const scale = getScaleFactor(width, height);
    const breakpoint = getBreakpoint(width, height);

    return {
      width,
      height,
      insets,
      scale,
      breakpoint,
      isSmallPhone: breakpoint === "smallLandscapePhone",
      isLargePhone: breakpoint === "largeLandscapePhone",
      isTablet: breakpoint === "tablet",
      isLandscape: width >= height,
      maxContentWidth: getMaxContentWidth(width, scale),

      /** Uniform scale - geometry. */
      s: (value) => scaleValue(value, scale),
      /** Damped scale - things that should move less than the layout. */
      ms: (value, factor) => moderateScale(value, scale, factor),
      /** Font scale - damped and clamped. */
      f: (value) => fontValue(value, scale),
      /** Visual size of a tap target, floored at the minimum. */
      touch: (value) => touchSize(value, scale),
      /** An edge offset that clears a cutout without moving when there is none. */
      safeLeft: (base) => safeOffset(scaleValue(base, scale), insets.left),
      safeRight: (base) => safeOffset(scaleValue(base, scale), insets.right),
      safeTop: (base) => safeOffset(scaleValue(base, scale), insets.top),
      safeBottom: (base) => safeOffset(scaleValue(base, scale), insets.bottom),
    };
  }, [width, height, insets]);
}

/**
 * A component's StyleSheet, scaled to the current viewport.
 *
 *   const rawStyles = { card: { width: 54 } };   // baseline numbers
 *   const styles = useScaledStyles(rawStyles);   // inside the component
 */
export function useScaledStyles(rawStyles) {
  const { scale } = useResponsive();
  return useMemo(() => getScaledSheet(rawStyles, scale), [rawStyles, scale]);
}
