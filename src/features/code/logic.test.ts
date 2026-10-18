import { describe, expect, it } from "vitest";
import { baseName, extOf, fileColor, filterEntries, humanSize, isSafeRel, langOf, parentDirs, pickRoot, rootLabel } from "./logic";

describe("code logic", () => {
  it("detects language by extension", () => {
    expect(langOf("src/App.tsx")).toBe("tsx");
    expect(langOf("lib.rs")).toBe("rust");
    expect(langOf("README.md")).toBe("markdown");
    expect(langOf("Makefile")).toBe("text");
    expect(langOf(".gitignore")).toBe("text");
    expect(extOf("a/b/c.TS")).toBe("ts");
    expect(baseName("a/b/c.ts")).toBe("c.ts");
  });
  it("colors known types", () => {
    expect(fileColor("x.rs")).not.toBe(fileColor("x.unknown"));
  });
  it("filters entries", () => {
    const es = [
      { name: "App.tsx", path: "App.tsx", isDir: false, size: 1 },
      { name: "main.ts", path: "main.ts", isDir: false, size: 1 },
    ];
    expect(filterEntries(es, "APP")).toHaveLength(1);
    expect(filterEntries(es, " ")).toHaveLength(2);
  });
  it("parent dirs", () => {
    expect(parentDirs("a/b/c.ts")).toEqual(["a", "a/b"]);
    expect(parentDirs("c.ts")).toEqual([]);
  });
  it("root choice + label", () => {
    expect(pickRoot("C:/dev/api", "x", "y")).toBe("C:/dev/api");
    expect(pickRoot("", " D:/d ", "y")).toBe("D:/d");
    expect(pickRoot(undefined, "", "C:/Users/p")).toBe("C:/Users/p");
    expect(rootLabel("C:\\dev\\api")).toBe("dev/api");
  });
  it("rejects unsafe relative paths", () => {
    for (const p of ["../x", "a/../../x", "/etc/passwd", "C:/x", "\\x", "a\\..\\b"]) expect(isSafeRel(p)).toBe(false);
    for (const p of ["", "a/b.ts", "..hidden/x", "a..b"]) expect(isSafeRel(p)).toBe(true);
  });
  it("formats sizes", () => {
    expect(humanSize(12)).toBe("12 B");
    expect(humanSize(2048)).toBe("2.0 KB");
    expect(humanSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
