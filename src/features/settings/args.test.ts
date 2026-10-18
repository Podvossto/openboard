import { describe, expect, it } from "vitest";
import { clampFont, formatArgs, parseArgs } from "./args";

describe("args", () => {
  it("splits on whitespace", () => {
    expect(parseArgs("  --a   --b=1 ")).toEqual(["--a", "--b=1"]);
    expect(parseArgs("")).toEqual([]);
  });
  it("handles quotes", () => {
    expect(parseArgs('--msg "hello world" \'x y\' ""')).toEqual(["--msg", "hello world", "x y", ""]);
  });
  it("round-trips", () => {
    const a = ["--flag", "two words", "", "it's"];
    expect(parseArgs(formatArgs(a))).toEqual(a);
  });
  it("clamps font", () => {
    expect(clampFont(5)).toBe(10);
    expect(clampFont(99)).toBe(20);
    expect(clampFont(NaN)).toBe(13);
    expect(clampFont(14.4)).toBe(14);
  });
});
