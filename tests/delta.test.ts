/** Change chips on the overview: absolute numbers on a small base, percentages only on a large one. */
import { describe, expect, it } from "vitest";
import { PERCENT_MIN_BASE, describeChange } from "../web/src/delta";

describe("describeChange", () => {
  it("shows the absolute change when the base is small", () => {
    expect(describeChange(15, 7, "count")).toEqual({ direction: "up", text: "+8", mode: "absolute" });
    expect(describeChange(5, 3, "count").text).toBe("+2");
    expect(describeChange(2, 6, "count")).toEqual({ direction: "down", text: "\u22124", mode: "absolute" });
  });

  it("shows a percentage only from the minimum base on", () => {
    const base = PERCENT_MIN_BASE.count;
    expect(describeChange(base + 6, base, "count").mode).toBe("percent");
    expect(describeChange(base + 6, base, "count").text).toBe(`+${Math.round((6 / base) * 100)} %`);
    expect(describeChange(base - 1 + 6, base - 1, "count").mode).toBe("absolute");
  });

  it("formats money in whole euros", () => {
    const c = describeChange(349_654, 272_300, "cents");
    expect(c.mode).toBe("absolute");
    expect(c.text.replace(/\s/g, " ")).toBe("+774 €");
    expect(describeChange(2_400_000, 2_000_000, "cents").text).toBe("+20 %");
  });

  it("marks a start from zero as new and no change as neutral", () => {
    expect(describeChange(4, 0, "count")).toEqual({ direction: "up", text: "+4", mode: "new" });
    expect(describeChange(0, 0, "count").mode).toBe("none");
    expect(describeChange(3, 3, "count")).toEqual({ direction: "same", text: "±0", mode: "absolute" });
  });
});
