import { describe, expect, it } from "vitest";
import type { Profile, ProviderPreset } from "./types";
import { modelChoices, prettyProviderModel } from "./models";

const zaiPreset: ProviderPreset = {
  id: "zai",
  name: "Z.ai",
  baseUrl: "https://api.z.ai/api/anthropic",
  model: "glm-5.3[1m]",
  smallModel: "glm-5.3-flash[1m]",
  keyHint: "",
  usage: true,
  models: ["glm-5.3[1m]", "glm-5.3-flash[1m]"],
  contextWindow: 1_000_000,
};
const zai: Profile = {
  id: "p",
  name: "Z.ai",
  cli: "claude",
  color: "",
  kind: { type: "provider", provider: "zai", baseUrl: zaiPreset.baseUrl, model: "glm-5.3[1m]", smallModel: "glm-5.3-flash[1m]" },
};

describe("modelChoices", () => {
  it("offers Claude aliases without a provider profile", () => {
    expect(modelChoices("claudeCode").map((m) => m.id)).toEqual(["", "opus", "sonnet", "haiku"]);
  });
  it("offers the provider's models — not opus/sonnet/haiku — for a provider profile", () => {
    const c = modelChoices("claudeCode", zai, [zaiPreset]);
    expect(c.map((m) => m.id)).toEqual(["", "glm-5.3-flash[1m]"]);
    expect(c[0]!.label).toBe("Default (GLM-5.3 · 1M)");
    expect(c.some((m) => m.id === "opus")).toBe(false);
  });
  it("custom provider model is offered even when not in the preset", () => {
    const p = { ...zai, kind: { ...zai.kind, model: "glm-4.6" } } as Profile;
    expect(modelChoices("claudeCode", p, [zaiPreset]).map((m) => m.id)).toEqual(["", "glm-5.3[1m]", "glm-5.3-flash[1m]"]);
  });
});

describe("prettyProviderModel", () => {
  it("formats GLM ids", () => {
    expect(prettyProviderModel("glm-5.3-flash[1m]")).toBe("GLM-5.3 Flash · 1M");
    expect(prettyProviderModel("glm-5.3")).toBe("GLM-5.3");
    expect(prettyProviderModel("kimi-k2-turbo-preview")).toBe("kimi-k2-turbo-preview");
  });
});
