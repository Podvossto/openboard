import { describe, expect, it } from "vitest";
import { formatBytes, friendlyError, progressPct, shouldPrompt, statusLine } from "./logic";

describe("updater logic", () => {
  it("progressPct clamps and handles unknown totals", () => {
    expect(progressPct(50, 200)).toBe(25);
    expect(progressPct(300, 200)).toBe(100);
    expect(progressPct(10, null)).toBeNull();
    expect(progressPct(10, 0)).toBeNull();
  });
  it("formatBytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1_572_864)).toBe("1.5 MB");
  });
  it("shouldPrompt: Later suppresses the auto prompt for that version only", () => {
    expect(shouldPrompt("0.2.0", null, false)).toBe(true);
    expect(shouldPrompt("0.2.0", "0.2.0", false)).toBe(false);
    expect(shouldPrompt("0.3.0", "0.2.0", false)).toBe(true);
    expect(shouldPrompt("0.2.0", "0.2.0", true)).toBe(true);
  });
  it("statusLine", () => {
    expect(statusLine("upToDate", null, null)).toBe("You're on the latest version.");
    expect(statusLine("available", "0.2.0", null)).toBe("Version 0.2.0 is available.");
    expect(statusLine("idle", null, null)).toBe("");
    expect(statusLine("error", null, "update: error sending request for url")).toContain("private network");
  });
  it("friendlyError", () => {
    expect(friendlyError(null)).toBe("unknown error");
    expect(friendlyError("update: signature mismatch")).toContain("signature");
    expect(friendlyError("update: boom")).toBe("boom");
    expect(friendlyError("x".repeat(200)).length).toBe(141);
  });
});
