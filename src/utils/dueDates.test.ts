import { afterEach, describe, expect, it, vi } from "vitest";
import { dueDateStatus } from "./dueDates";

afterEach(() => {
  vi.useRealTimers();
});

function setToday(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

// ---------------------------------------------------------------------------
// Tests 1-6: Core DueDateKind semantics
// ---------------------------------------------------------------------------

describe("dueDateStatus — core semantics", () => {
  it("1. overdue: dueDate in the past", () => {
    const result = dueDateStatus("2026-08-10", "2026-08-21");
    expect(result.kind).toBe("overdue");
    expect(result.days).toBe(-11);
    expect(result.tone).toBe("red");
    expect(result.label).toMatch(/Vencido hace 11 días/);
    expect(result.dueDate).toBe("2026-08-10");
  });

  it("2. today: dueDate === todayKey", () => {
    const result = dueDateStatus("2026-08-21", "2026-08-21");
    expect(result.kind).toBe("today");
    expect(result.days).toBe(0);
    expect(result.tone).toBe("orange");
    expect(result.label).toBe("Vence hoy");
    expect(result.dueDate).toBe("2026-08-21");
  });

  it("3. tomorrow: dueDate is 1 day ahead", () => {
    const result = dueDateStatus("2026-08-22", "2026-08-21");
    expect(result.kind).toBe("tomorrow");
    expect(result.days).toBe(1);
    expect(result.tone).toBe("yellow");
    expect(result.label).toBe("Vence mañana");
  });

  it("4. upcoming: 2-7 days ahead (diff=5)", () => {
    const result = dueDateStatus("2026-08-26", "2026-08-21");
    expect(result.kind).toBe("upcoming");
    expect(result.days).toBe(5);
    expect(result.tone).toBe("blue");
    expect(result.label).toBe("Vence en 5 días");
  });

  it("4b. upcoming boundary: exactly 7 days", () => {
    const result = dueDateStatus("2026-08-28", "2026-08-21");
    expect(result.kind).toBe("upcoming");
    expect(result.days).toBe(7);
  });

  it("5. later: more than 7 days ahead (diff=10)", () => {
    const result = dueDateStatus("2026-08-31", "2026-08-21");
    expect(result.kind).toBe("later");
    expect(result.days).toBe(10);
    expect(result.tone).toBe("blue");
    expect(result.label).toMatch(/10 días/);
  });

  it("6a. null dueDate → later / Fecha por confirmar", () => {
    const result = dueDateStatus(null, "2026-08-21");
    expect(result.kind).toBe("later");
    expect(result.label).toBe("Fecha por confirmar");
    expect(result.days).toBe(999);
    expect(result.dueDate).toBeUndefined();
  });

  it("6b. invalid date string → later / Fecha por confirmar", () => {
    const result = dueDateStatus("not-a-date", "2026-08-21");
    expect(result.kind).toBe("later");
    expect(result.label).toBe("Fecha por confirmar");
  });

  it("6c. overdue singular label for 1 day", () => {
    const result = dueDateStatus("2026-08-20", "2026-08-21");
    expect(result.kind).toBe("overdue");
    expect(result.label).toBe("Vencido hace 1 día");
  });
});

// ---------------------------------------------------------------------------
// Test 7: month-end / local date behavior (uses wall clock via fake timers)
// ---------------------------------------------------------------------------

describe("dueDateStatus — optional todayKey (wall-clock fallback)", () => {
  it("7a. uses wall clock when todayKey is omitted", () => {
    setToday("2026-08-21T12:00:00Z");
    const result = dueDateStatus("2026-08-21");
    // Should be "today" since the local date derived from the fake clock is 2026-08-21
    expect(result.kind).toBe("today");
  });

  it("7b. explicit todayKey overrides wall clock", () => {
    setToday("2026-08-21T12:00:00Z");
    const result = dueDateStatus("2026-08-10", "2026-08-15");
    // relative to 2026-08-15, 2026-08-10 is 5 days ago
    expect(result.kind).toBe("overdue");
    expect(result.days).toBe(-5);
  });
});
