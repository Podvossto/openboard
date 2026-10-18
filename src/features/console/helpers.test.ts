import { describe, expect, it } from "vitest";
import { canResume, relativeTime, shortPath, shouldNotify } from "./helpers";

describe("shortPath", () => {
  it("keeps last two segments", () => {
    expect(shortPath("/home/dev/proj/app")).toBe("proj/app");
    expect(shortPath("C:\\Users\\me\\code\\x")).toBe("code/x");
  });
  it("handles short and empty", () => {
    expect(shortPath("/")).toBe("/");
    expect(shortPath("")).toBe("");
    expect(shortPath("/a")).toBe("a");
    expect(shortPath("/a/b/", 1)).toBe("b");
  });
});

describe("relativeTime", () => {
  const now = 1_000_000_000;
  it("formats units", () => {
    expect(relativeTime(now - 500, now)).toBe("just now");
    expect(relativeTime(now - 12_000, now)).toBe("12s ago");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(relativeTime(now - 50 * 3_600_000, now)).toBe("2d ago");
    expect(relativeTime(now + 5000, now)).toBe("just now");
  });
});

describe("canResume", () => {
  it("rules per agent", () => {
    expect(canResume({ agent: { kind: "claudeCode" } })).toBe(false);
    expect(canResume({ agent: { kind: "claudeCode" }, agentSession: "s" })).toBe(true);
    expect(canResume({ agent: { kind: "codex" } })).toBe(true);
    expect(canResume({ agent: { kind: "custom", program: "" } })).toBe(false);
  });
});

describe("shouldNotify", () => {
  it("only on transition while unfocused", () => {
    expect(shouldNotify("working", "needsYou", false)).toBe(true);
    expect(shouldNotify("needsYou", "needsYou", false)).toBe(false);
    expect(shouldNotify("working", "needsYou", true)).toBe(false);
    expect(shouldNotify("working", "resting", false)).toBe(false);
  });
});
