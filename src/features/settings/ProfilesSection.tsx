import { useCallback, useEffect, useState } from "react";
import { ipc } from "../../lib/ipc";
import type { KeyStatus, Profile, ProviderPreset } from "../../lib/types";
import { AgentIcon } from "../../components/AgentIcon";
import { PROFILE_COLORS, newProfileId, presetToKind } from "./profiles";

/**
 * Settings → Accounts & providers.
 * - "Account": a second (third…) login of Claude Code or Codex, isolated config dir.
 * - "Provider": Claude Code driven by an Anthropic-compatible endpoint (Z.ai GLM, Kimi, …).
 * API keys go to the OS credential store via IPC — they are never kept in React state
 * after saving and never written to settings.json.
 */
export function ProfilesSection({
  profiles,
  onChange,
  onLogin,
}: {
  profiles: Profile[];
  onChange: (p: Profile[]) => void;
  onLogin: (p: Profile) => void;
}) {
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [keys, setKeys] = useState<KeyStatus[]>([]);
  const [adding, setAdding] = useState<null | "account" | "provider">(null);

  const refreshKeys = useCallback(() => {
    ipc
      .profileKeyStatus()
      .then(setKeys)
      .catch(() => setKeys([]));
  }, []);

  useEffect(() => {
    ipc
      .providerPresets()
      .then(setPresets)
      .catch(() => setPresets([]));
    refreshKeys();
  }, [refreshKeys]);

  const add = (p: Profile) => {
    onChange([...profiles, p]);
    setAdding(null);
    // key status comes from the backend once settings are saved
    window.setTimeout(refreshKeys, 600);
  };

  return (
    <div className="flex flex-col gap-3">
      {profiles.length === 0 && !adding && (
        <p className="help">
          Add another login of the same CLI (e.g. work + personal Claude), or run Claude Code on another provider such as
          Z.ai GLM.
        </p>
      )}
      {profiles.map((p) => (
        <ProfileCard
          key={p.id}
          p={p}
          keyStatus={keys.find((k) => k.id === p.id)}
          presets={presets}
          onPatch={(patch) => onChange(profiles.map((x) => (x.id === p.id ? { ...x, ...patch } : x)))}
          onRemove={() => {
            onChange(profiles.filter((x) => x.id !== p.id));
            void ipc.deleteProfileKey(p.id).catch(() => undefined);
          }}
          onKeySaved={refreshKeys}
          onLogin={() => onLogin(p)}
        />
      ))}
      {adding ? (
        <AddProfile kind={adding} presets={presets} count={profiles.length} onAdd={add} onCancel={() => setAdding(null)} />
      ) : (
        <div className="flex gap-2">
          <button className="btn sm" onClick={() => setAdding("account")}>
            + Account
          </button>
          <button className="btn sm" onClick={() => setAdding("provider")}>
            + Provider
          </button>
        </div>
      )}
    </div>
  );
}

function ProfileCard({
  p,
  keyStatus,
  presets,
  onPatch,
  onRemove,
  onKeySaved,
  onLogin,
}: {
  p: Profile;
  keyStatus?: KeyStatus;
  presets: ProviderPreset[];
  onPatch: (patch: Partial<Profile>) => void;
  onRemove: () => void;
  onKeySaved: () => void;
  onLogin: () => void;
}) {
  const [key, setKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const isProvider = p.kind.type === "provider";
  const preset = p.kind.type === "provider" ? presets.find((x) => x.id === (p.kind as { provider: string }).provider) : undefined;
  const saveKey = async () => {
    try {
      await ipc.setProfileKey(p.id, key);
      setKey("");
      setErr(null);
      onKeySaved();
    } catch (e) {
      setErr(String(e));
    }
  };
  return (
    <div className="agent-card" data-profile={p.id}>
      <div className="agent-card-head">
        <span className="relative grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-black/30">
          <AgentIcon agent={p.cli === "claude" ? "claudeCode" : "codex"} size={17} />
          <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-surface" style={{ background: p.color }} />
        </span>
        <input
          aria-label="Profile name"
          className="min-w-0 flex-1 bg-transparent text-[13.5px] font-semibold text-ink outline-none"
          defaultValue={p.name}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== p.name) onPatch({ name });
          }}
        />
        {isProvider ? (
          <span className={`chip ${keyStatus?.hasKey ? "ok" : "warn"}`}>{keyStatus?.hasKey ? "Key saved" : "No key"}</span>
        ) : (
          <span className="chip off">{p.cli === "claude" ? "Claude account" : "Codex account"}</span>
        )}
        <button className="btn ghost sm" aria-label={`Remove ${p.name}`} onClick={onRemove}>
          Remove
        </button>
        <span className="agent-detail">
          {p.kind.type === "provider"
            ? `${preset?.name ?? p.kind.provider} · ${p.kind.model || "default model"}`
            : "Separate login and history"}
        </span>
      </div>
      {p.kind.type === "provider" ? (
        <>
          <div className="row">
            <input
              aria-label="Base URL"
              className="input grow font-mono !text-[12px]"
              defaultValue={p.kind.baseUrl}
              spellCheck={false}
              onBlur={(e) => {
                const k = p.kind;
                if (k.type === "provider" && e.target.value.trim() && e.target.value.trim() !== k.baseUrl)
                  onPatch({ kind: { ...k, baseUrl: e.target.value.trim() } });
              }}
            />
          </div>
          <details className="profile-advanced" data-testid="profile-advanced">
            <summary className="cursor-pointer select-none text-[11.5px] font-semibold text-ink-3 hover:text-ink">Advanced: model ids</summary>
            <p className="help !mt-1">Filled from the {preset?.name ?? "provider"} preset — change only for a different model. Typos like "GLM5.3" are fixed automatically.</p>
  <div className="row">
              <input
                aria-label="Model"
                className="input grow font-mono !text-[12px]"
                placeholder="model"
                defaultValue={p.kind.model}
                onBlur={(e) => {
                  const k = p.kind;
                  if (k.type === "provider" && e.target.value.trim() !== k.model) onPatch({ kind: { ...k, model: e.target.value.trim() } });
                }}
              />
              <input
                aria-label="Fast model"
                className="input grow font-mono !text-[12px]"
                placeholder="fast model"
                defaultValue={p.kind.smallModel}
                onBlur={(e) => {
                  const k = p.kind;
                  if (k.type === "provider" && e.target.value.trim() !== k.smallModel)
                    onPatch({ kind: { ...k, smallModel: e.target.value.trim() } });
                }}
              />
            </div>
          </details>
          <div className="row">
            <input
              aria-label="API key"
              type="password"
              autoComplete="off"
              className="input grow"
              placeholder={keyStatus?.masked ? `Saved ${keyStatus.masked} — paste to replace` : `API key (${preset?.keyHint ?? "from your provider"})`}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && key.trim() && void saveKey()}
            />
            <button className="btn sm primary" disabled={!key.trim()} onClick={() => void saveKey()}>
              Save key
            </button>
          </div>
          {err && <p className="help !text-danger">{err}</p>}
        </>
      ) : (
        <div className="row">
          <button className="btn sm" onClick={onLogin}>
            Sign in to this account
          </button>
          <span className="help">Opens a console with the {p.cli === "claude" ? "Claude" : "Codex"} login flow for this profile.</span>
        </div>
      )}
      <div className="flex gap-1.5" role="radiogroup" aria-label="Profile color">
        {PROFILE_COLORS.map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={p.color === c}
            aria-label={`Color ${c}`}
            className={`size-4 rounded-full transition ${p.color === c ? "ring-2 ring-ink ring-offset-2 ring-offset-surface-2" : "opacity-60 hover:opacity-100"}`}
            style={{ background: c }}
            onClick={() => onPatch({ color: c })}
          />
        ))}
      </div>
    </div>
  );
}

function AddProfile({
  kind,
  presets,
  count,
  onAdd,
  onCancel,
}: {
  kind: "account" | "provider";
  presets: ProviderPreset[];
  count: number;
  onAdd: (p: Profile) => void;
  onCancel: () => void;
}) {
  const [cli, setCli] = useState<"claude" | "codex">("claude");
  const [presetId, setPresetId] = useState("zai");
  const [name, setName] = useState("");
  const color = PROFILE_COLORS[count % PROFILE_COLORS.length]!;
  const preset = presets.find((p) => p.id === presetId);
  const defaultName = kind === "account" ? `${cli === "claude" ? "Claude" : "Codex"} · account ${count + 2}` : (preset?.name ?? "Provider");
  const create = () => {
    const id = newProfileId();
    if (kind === "account") onAdd({ id, name: name.trim() || defaultName, cli, kind: { type: "subscription" }, color });
    else if (preset) onAdd({ id, name: name.trim() || defaultName, cli: "claude", kind: presetToKind(preset), color });
    else
      onAdd({
        id,
        name: name.trim() || "Custom provider",
        cli: "claude",
        kind: { type: "provider", provider: "custom", baseUrl: "https://", model: "", smallModel: "" },
        color,
      });
  };
  return (
    <div className="agent-card" role="group" aria-label={kind === "account" ? "New account" : "New provider"}>
      <strong className="text-[13.5px] text-ink">{kind === "account" ? "New account" : "New provider (via Claude Code)"}</strong>
      {kind === "account" ? (
        <div className="seg">
          {(["claude", "codex"] as const).map((c) => (
            <button key={c} className={cli === c ? "on" : ""} onClick={() => setCli(c)}>
              {c === "claude" ? "Claude Code" : "Codex"}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {[...presets, { id: "custom", name: "Custom…" } as ProviderPreset].map((p) => (
            <button
              key={p.id}
              aria-pressed={presetId === p.id}
              className={`h-8 rounded-full border px-3 text-[12px] font-semibold transition ${
                presetId === p.id ? "border-accent/70 bg-accent/12 text-ink" : "border-line text-ink-2 hover:border-line-strong hover:text-ink"
              }`}
              onClick={() => setPresetId(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
      <input aria-label="New profile name" className="input" placeholder={defaultName} value={name} onChange={(e) => setName(e.target.value)} />
      <div className="flex justify-end gap-2">
        <button className="btn ghost sm" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn sm primary" onClick={create}>
          Add
        </button>
      </div>
    </div>
  );
}
