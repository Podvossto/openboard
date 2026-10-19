import { describe, expect, it } from "vitest";
import type { Profile } from "../../lib/types";
import { presetToKind, profilesFor } from "./profiles";

const ps: Profile[] = [
  { id: "a", name: "Work", cli: "claude", kind: { type: "subscription" }, color: "" },
  { id: "b", name: "Z.ai", cli: "claude", kind: { type: "provider", provider: "zai", baseUrl: "u", model: "m", smallModel: "s" }, color: "" },
  { id: "c", name: "Codex 2", cli: "codex", kind: { type: "subscription" }, color: "" },
];

describe("profiles", () => {
  it("filters by CLI", () => {
    expect(profilesFor({ kind: "claudeCode" }, ps).map((p) => p.id)).toEqual(["a", "b"]);
    expect(profilesFor({ kind: "codex" }, ps).map((p) => p.id)).toEqual(["c"]);
    expect(profilesFor({ kind: "custom", program: "" }, ps)).toEqual([]);
  });
  it("maps a preset to a provider kind", () => {
    expect(
      presetToKind({ id: "zai", name: "Z", baseUrl: "https://api.z.ai/api/anthropic", model: "glm-4.6", smallModel: "glm-4.5-air", keyHint: "", usage: true, models: [], contextWindow: 0 }),
    ).toEqual({ type: "provider", provider: "zai", baseUrl: "https://api.z.ai/api/anthropic", model: "glm-4.6", smallModel: "glm-4.5-air" });
  });
});
