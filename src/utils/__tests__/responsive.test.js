// The scaling primitives.
//
// The invariant that matters most: on the baseline viewport (iPhone 17 Pro
// landscape, 874 x 402) every helper is the identity. That is what guarantees
// the reference design cannot regress - the responsive system is a no-op there
// and only does anything on other sizes.

import {
  BASE_HEIGHT,
  BASE_WIDTH,
  FONT_MAX_RATIO,
  FONT_MIN_RATIO,
  MAX_SCALE,
  MIN_SCALE,
  MIN_TOUCH_TARGET,
  clamp,
  fontValue,
  getBreakpoint,
  getMaxContentWidth,
  getScaleFactor,
  moderateScale,
  safeOffset,
  scaleStyle,
  scaleValue,
  touchSize,
  touchSlop,
} from "../responsive";

// Representative landscape viewports, all in logical points.
const VIEWPORTS = {
  iphoneSE: [667, 375],
  smallAndroid: [640, 360],
  iphone13: [844, 390],
  baseline: [BASE_WIDTH, BASE_HEIGHT], // iPhone 17 Pro
  proMax: [956, 440],
  tallAndroid: [915, 412], // 20:9 Pixel-class
  ipad: [1024, 768],
  ipadPro: [1366, 1024],
};

describe("the baseline viewport is untouched", () => {
  const [w, h] = VIEWPORTS.baseline;
  const scale = getScaleFactor(w, h);

  it("scales by exactly 1", () => {
    expect(scale).toBe(1);
  });

  it("leaves every helper as the identity", () => {
    for (const value of [0, 1, 1.5, 12, 54, 90, 402]) {
      expect(scaleValue(value, scale)).toBe(value);
      expect(moderateScale(value, scale)).toBe(value);
      expect(fontValue(value, scale)).toBe(value);
    }
  });

  it("leaves a whole style object byte-identical", () => {
    const style = {
      width: 54,
      height: 76,
      fontSize: 20,
      letterSpacing: 1.5,
      borderWidth: 1.5,
      marginHorizontal: -8,
      shadowOffset: { width: 0, height: 3 },
      transform: [{ translateY: -15 }],
      backgroundColor: "#FFF",
      flex: 1,
    };
    expect(scaleStyle(style, scale)).toBe(style);
  });
});

describe("the scale factor", () => {
  it("is the smaller of the two axis ratios, so nothing ever overflows", () => {
    // A screen twice as tall in proportion must not scale up on height alone.
    expect(getScaleFactor(BASE_WIDTH, BASE_HEIGHT * 2)).toBe(1);
    expect(getScaleFactor(BASE_WIDTH / 2, BASE_HEIGHT)).toBeCloseTo(0.65, 5);
  });

  it("shrinks on a small phone and grows on a tablet", () => {
    expect(getScaleFactor(...VIEWPORTS.iphoneSE)).toBeLessThan(1);
    expect(getScaleFactor(...VIEWPORTS.ipad)).toBeGreaterThan(1);
  });

  it("stays inside its bounds on extreme viewports", () => {
    for (const [w, h] of [[200, 120], [4000, 3000], ...Object.values(VIEWPORTS)]) {
      const scale = getScaleFactor(w, h);
      expect(scale).toBeGreaterThanOrEqual(MIN_SCALE);
      expect(scale).toBeLessThanOrEqual(MAX_SCALE);
    }
  });

  it("survives a zero-sized viewport rather than producing NaN", () => {
    expect(getScaleFactor(0, 0)).toBe(1);
    expect(getScaleFactor(undefined, undefined)).toBe(1);
  });
});

describe("font scaling", () => {
  it("moves less than the layout does", () => {
    for (const [w, h] of Object.values(VIEWPORTS)) {
      const scale = getScaleFactor(w, h);
      if (scale === 1) continue;
      const layoutDelta = Math.abs(scaleValue(20, scale) - 20);
      const fontDelta = Math.abs(fontValue(20, scale) - 20);
      expect(fontDelta).toBeLessThan(layoutDelta);
    }
  });

  it("stays inside the readable band on every viewport", () => {
    for (const [w, h] of [[200, 120], [4000, 3000], ...Object.values(VIEWPORTS)]) {
      const scale = getScaleFactor(w, h);
      const size = fontValue(14, scale);
      expect(size).toBeGreaterThanOrEqual(14 * FONT_MIN_RATIO);
      expect(size).toBeLessThanOrEqual(14 * FONT_MAX_RATIO);
    }
  });

  it("keeps the smallest text in the app legible on the smallest phone", () => {
    const scale = getScaleFactor(...VIEWPORTS.smallAndroid);
    // 11pt is the smallest size in the design (a seat's player name).
    expect(fontValue(11, scale)).toBeGreaterThan(8.5);
  });
});

describe("tap targets", () => {
  it("never shrink below the platform minimum, however small the screen", () => {
    for (const [w, h] of Object.values(VIEWPORTS)) {
      const scale = getScaleFactor(w, h);
      expect(touchSize(52, scale)).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    }
  });

  it("do not inflate a target that is already smaller than the minimum by design", () => {
    // A 28pt close button stays 28pt visually; hitSlop makes up the rest.
    expect(touchSize(28, 1)).toBe(28);
  });

  it("pad a small control back up to the minimum with hitSlop", () => {
    const slop = touchSlop(28);
    expect(28 + slop.left + slop.right).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });
});

describe("breakpoints", () => {
  it("classify by geometry, not by device", () => {
    expect(getBreakpoint(...VIEWPORTS.iphoneSE)).toBe("smallLandscapePhone");
    expect(getBreakpoint(...VIEWPORTS.smallAndroid)).toBe("smallLandscapePhone");
    expect(getBreakpoint(...VIEWPORTS.baseline)).toBe("normalLandscapePhone");
    expect(getBreakpoint(...VIEWPORTS.iphone13)).toBe("normalLandscapePhone");
    expect(getBreakpoint(...VIEWPORTS.proMax)).toBe("largeLandscapePhone");
    expect(getBreakpoint(...VIEWPORTS.tallAndroid)).toBe("largeLandscapePhone");
    expect(getBreakpoint(...VIEWPORTS.ipad)).toBe("tablet");
    expect(getBreakpoint(...VIEWPORTS.ipadPro)).toBe("tablet");
  });

  it("does not depend on which way round the dimensions are given", () => {
    for (const [w, h] of Object.values(VIEWPORTS)) {
      expect(getBreakpoint(w, h)).toBe(getBreakpoint(h, w));
    }
  });
});

describe("content width", () => {
  it("is the whole screen on a phone", () => {
    for (const key of ["iphoneSE", "baseline", "proMax"]) {
      const [w, h] = VIEWPORTS[key];
      expect(getMaxContentWidth(w, getScaleFactor(w, h))).toBe(w);
    }
  });

  it("stops prose spanning the whole of a large tablet", () => {
    const [w, h] = VIEWPORTS.ipadPro;
    expect(getMaxContentWidth(w, getScaleFactor(w, h))).toBeLessThan(w);
  });
});

describe("safe-area offsets", () => {
  it("are the plain offset when there is no cutout", () => {
    expect(safeOffset(16, 0)).toBe(16);
    expect(safeOffset(16, undefined)).toBe(16);
  });

  it("push a control clear of a cutout without doubling the margin", () => {
    expect(safeOffset(16, 59)).toBe(59);
    expect(safeOffset(80, 59)).toBe(80);
  });
});

describe("style scaling", () => {
  const scale = getScaleFactor(...VIEWPORTS.iphoneSE);

  it("scales geometry and leaves non-geometry alone", () => {
    const out = scaleStyle(
      { width: 100, flex: 1, opacity: 0.5, backgroundColor: "#FFF", zIndex: 9 },
      scale
    );
    expect(out.width).toBeCloseTo(100 * scale, 5);
    expect(out.flex).toBe(1);
    expect(out.opacity).toBe(0.5);
    expect(out.backgroundColor).toBe("#FFF");
    expect(out.zIndex).toBe(9);
  });

  it("leaves percentage sizes as percentages", () => {
    expect(scaleStyle({ width: "50%", bottom: "18%" }, scale)).toEqual({
      width: "50%",
      bottom: "18%",
    });
  });

  it("scales negative offsets in the same direction", () => {
    const out = scaleStyle({ marginHorizontal: -8, top: -85 }, scale);
    expect(out.marginHorizontal).toBeCloseTo(-8 * scale, 5);
    expect(out.top).toBeCloseTo(-85 * scale, 5);
  });

  it("keeps a visible border at any scale", () => {
    const tiny = getScaleFactor(200, 120);
    expect(scaleStyle({ borderWidth: 1 }, tiny).borderWidth).toBeGreaterThanOrEqual(1);
    expect(scaleStyle({ borderWidth: 3 }, tiny).borderWidth).toBeGreaterThanOrEqual(1);
  });

  it("scales inside shadow offsets and transforms", () => {
    const out = scaleStyle(
      {
        shadowOffset: { width: 0, height: 8 },
        transform: [{ translateY: -15 }, { rotate: "-45deg" }, { scale: 1.2 }],
      },
      scale
    );
    expect(out.shadowOffset.height).toBeCloseTo(8 * scale, 5);
    expect(out.transform[0].translateY).toBeCloseTo(-15 * scale, 5);
    // A rotation and a transform-scale are not lengths.
    expect(out.transform[1].rotate).toBe("-45deg");
    expect(out.transform[2].scale).toBe(1.2);
  });
});

describe("clamp", () => {
  it("bounds a value", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it("prefers the minimum when the range is inverted", () => {
    expect(clamp(5, 10, 0)).toBe(10);
  });
});
