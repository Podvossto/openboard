import { describe, expect, it } from "vitest";
import { addDays, addMonths, dayLabel, dow, fromISO, isSameMonth, monthGrid, monthLabel, shortLabel, toISO, todayISO, weekOf } from "./calendar";

describe("iso parsing + formatting", () => {
  it("round-trips and rejects junk", () => {
    expect(fromISO("2026-10-18")).toEqual({ y: 2026, m: 10, d: 18 });
    expect(toISO(2026, 10, 4)).toBe("2026-10-04");
    expect(fromISO("2026-13-01")).toBeNull();
    expect(fromISO("2026-02-30")).toBeNull();
    expect(fromISO("nope")).toBeNull();
    expect(fromISO("2026-10-18T00:00:00Z")).toBeNull();
  });
  it("today is a real ISO date", () => {
    expect(fromISO(todayISO())).not.toBeNull();
  });
});

describe("arithmetic", () => {
  it("addDays crosses month/year/leap boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29"); // leap
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01"); // not leap
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("addMonths clamps the day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-10-18", -1)).toBe("2026-09-18");
    expect(addMonths("2026-10-18", 3)).toBe("2027-01-18");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29"); // leap gets its extra day
  });
  it("dow is Monday-first", () => {
    expect(dow("2024-01-01")).toBe(0); // Monday
    expect(dow("2026-10-18")).toBe(6); // Sunday
  });
});

describe("monthGrid", () => {
  it("is 42 cells, Monday-first, covering the whole month", () => {
    const grid = monthGrid("2026-10-18");
    expect(grid).toHaveLength(42);
    expect(dow(grid[0]!)).toBe(0);
    expect(grid.slice(0, 7)).toContain("2026-10-01"); // the 1st is in the first row
    // every day of the month appears exactly once
    const days = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
    for (const d of days) expect(grid.filter((x) => x === d)).toHaveLength(1);
    expect(grid[41]).toBe("2026-11-08"); // 6 full weeks from Mon 2026-09-28
    expect(grid.slice(0, 7)).toEqual(weekOf("2026-10-01"));
  });
  it("pads leading days from the previous month", () => {
    const grid = monthGrid("2026-10-18");
    expect(grid[0]).toBe("2026-09-28"); // Thu 2026-10-01 → back 3 days to Monday
  });
});

describe("weekOf", () => {
  it("returns Mon..Sun containing the date", () => {
    const week = weekOf("2026-10-18");
    expect(week).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
    expect(dow(week[0]!)).toBe(0);
    // adjacent days outside the week are absent
    expect(week).not.toContain("2026-10-11");
    expect(week).not.toContain("2026-10-19");
  });
  it("wraps across month ends", () => {
    expect(weekOf("2026-11-01")[0]).toBe("2026-10-26");
  });
});

describe("labels", () => {
  it("formats month/day labels", () => {
    expect(monthLabel("2026-10-18")).toBe("October 2026");
    expect(dayLabel("2026-10-18")).toBe("Sun 18");
    expect(shortLabel("2026-10-15")).toBe("Thu 15 Oct");
  });
  it("isSameMonth compares the YYYY-MM prefix", () => {
    expect(isSameMonth("2026-10-01", "2026-10-31")).toBe(true);
    expect(isSameMonth("2026-10-31", "2026-11-01")).toBe(false);
  });
});
