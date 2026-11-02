import { describe, expect, it } from "vitest";
import {
  QMA_AZIMUTHS,
  QMA_DISTANCES,
  QMA_ELEVATIONS,
  QMA_TURN_SET,
  QMA_VIEWS,
  orbitDrag,
  parseQmaPrompt,
  qmaAzimuth,
  qmaDistance,
  qmaElevation,
  qmaLabel,
  qmaPose,
  qmaPoseOf,
  qmaPrompt,
  qmaRunPrompt,
  qmaView,
  qmaWords,
} from "@/lib/qma";

// Package qma-angles: Fuobe's camera pose (the Angles app's horizontal_angle / vertical_angle / zoom, Cinema's ScenePose) to
// the QMA LoRA's 96 views and back.
describe("QMA views", () => {
  it("has the card's 8 × 4 × 3 = 96 views, each once", () => {
    expect(QMA_AZIMUTHS).toHaveLength(8);
    expect(QMA_ELEVATIONS).toHaveLength(4);
    expect(QMA_DISTANCES).toHaveLength(3);
    expect(QMA_VIEWS).toHaveLength(96);
    expect(new Set(QMA_VIEWS.map(qmaWords)).size).toBe(96);
  });

  it("round-trips every one of the 96 views through its pose, its prompt and its label", () => {
    for (const v of QMA_VIEWS) {
      expect(qmaView(qmaPose(v))).toEqual(v);
      const p = qmaPrompt(v);
      expect(p).toBe(`<qma> ${v.azimuth} ${v.elevation} ${v.distance}`);
      expect(parseQmaPrompt(p)).toEqual({ view: v, words: "" });
      expect(parseQmaPrompt(qmaPrompt(v, "make it night"))).toEqual({ view: v, words: "make it night" });
      expect(qmaRunPrompt(p, { horizontal_angle: 999 })).toBe(p);
      expect(qmaLabel(v).split(" · ")).toHaveLength(3);
    }
  });

  it("keeps the card's order and wording in the prompt", () => {
    expect(qmaPrompt({ azimuth: "right side view", elevation: "eye-level shot", distance: "medium shot" })).toBe("<qma> right side view eye-level shot medium shot");
    expect(qmaPrompt({ azimuth: "back view", elevation: "elevated shot", distance: "wide shot" })).toBe("<qma> back view elevated shot wide shot");
    expect(qmaPrompt({ azimuth: "front-left quarter view", elevation: "low-angle shot", distance: "close-up" }, "  ")).toBe("<qma> front-left quarter view low-angle shot close-up");
  });
});

describe("snapping a pose", () => {
  it("snaps the azimuth to 45° steps, halfway going on round to the right, and wraps", () => {
    expect(qmaAzimuth(0)).toBe("front view");
    expect(qmaAzimuth(22.49)).toBe("front view");
    expect(qmaAzimuth(22.5)).toBe("front-right quarter view");
    expect(qmaAzimuth(67.5)).toBe("right side view");
    expect(qmaAzimuth(180)).toBe("back view");
    expect(qmaAzimuth(337.49)).toBe("front-left quarter view");
    expect(qmaAzimuth(337.5)).toBe("front view");
    expect(qmaAzimuth(360)).toBe("front view");
    expect(qmaAzimuth(-45)).toBe("front-left quarter view");
    expect(qmaAzimuth(-90)).toBe("left side view");
    expect(qmaAzimuth(405)).toBe("front-right quarter view");
    expect(qmaAzimuth(Number.NaN)).toBe("front view");
  });

  it("bands the height at the midpoints of −30, 0, 30 and 60", () => {
    expect(qmaElevation(-90)).toBe("low-angle shot");
    expect(qmaElevation(-15.01)).toBe("low-angle shot");
    expect(qmaElevation(-15)).toBe("eye-level shot");
    expect(qmaElevation(14.99)).toBe("eye-level shot");
    expect(qmaElevation(15)).toBe("elevated shot");
    expect(qmaElevation(44.99)).toBe("elevated shot");
    expect(qmaElevation(45)).toBe("high-angle shot");
    expect(qmaElevation(90)).toBe("high-angle shot");
  });

  it("bands the distance as Cinema's pose words do", () => {
    expect(qmaDistance(0)).toBe("wide shot");
    expect(qmaDistance(2.5)).toBe("wide shot");
    expect(qmaDistance(2.51)).toBe("medium shot");
    expect(qmaDistance(7.49)).toBe("medium shot");
    expect(qmaDistance(7.5)).toBe("close-up");
    expect(qmaDistance(10)).toBe("close-up");
  });

  it("reads a run's settings, filling what's missing from a quarter turn at eye level", () => {
    expect(qmaPoseOf(undefined)).toEqual({ horizontal: 45, vertical: 0, zoom: 5 });
    expect(qmaPoseOf({ horizontal_angle: "180", vertical_angle: 60, zoom: 0 })).toEqual({ horizontal: 180, vertical: 60, zoom: 0 });
    expect(qmaRunPrompt("make it snow", { horizontal_angle: 90 })).toBe("<qma> right side view eye-level shot medium shot make it snow");
    expect(qmaRunPrompt("", {})).toBe("<qma> front-right quarter view eye-level shot medium shot");
    // A trigger with no camera words after it isn't a QMA prompt: the pose's words go in, the stray trigger out.
    expect(qmaRunPrompt("<qma> a red car", { horizontal_angle: 180 })).toBe("<qma> back view eye-level shot medium shot a red car");
    // A partial QMA prompt keeps the camera words it gives; the pose fills only the missing ones.
    expect(qmaRunPrompt("<qma> back view", {})).toBe("<qma> back view eye-level shot medium shot");
    expect(qmaRunPrompt("<qma> left side view high-angle shot, at night", { horizontal_angle: 0, zoom: 10 })).toBe("<qma> left side view high-angle shot close-up at night");
    expect(qmaRunPrompt("<qma> wide shot a red car", { horizontal_angle: 90 })).toBe("<qma> right side view eye-level shot wide shot a red car");
  });
});

describe("the orbit pad and the turnaround set", () => {
  it("turns once round across the pad and raises the camera dragging up", () => {
    const start = { horizontal: 0, vertical: 0, zoom: 5 };
    expect(orbitDrag(start, 50, 0, 200).horizontal).toBe(90);
    expect(qmaView(orbitDrag(start, 50, 0, 200)).azimuth).toBe("right side view");
    expect(orbitDrag(start, -50, 0, 200).horizontal).toBe(270);
    expect(qmaView(orbitDrag(start, 0, -50, 200)).elevation).toBe("elevated shot");
    expect(orbitDrag(start, 0, -1000, 200).vertical).toBe(90);
    expect(orbitDrag(start, 0, 1000, 200).vertical).toBe(-30);
  });

  it("makes the 8 azimuths at eye level, front first", () => {
    expect(QMA_TURN_SET.map((v) => v.azimuth)).toEqual([...QMA_AZIMUTHS]);
    expect(new Set(QMA_TURN_SET.map((v) => v.elevation))).toEqual(new Set(["eye-level shot"]));
  });
});
