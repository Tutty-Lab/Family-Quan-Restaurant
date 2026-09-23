import { describe, expect, it } from "vitest";
import type { Employee, Shift } from "../../types";
import { maxConsecutiveRun } from "../consecutive";
import { validateSchedule } from "../validation";

const employee: Employee = {
  id: "a", name: "An", employmentType: "TEILZEIT", targetMinutes: 0,
};
const shift = (date: string, start: number, end: number): Shift => ({
  id: `${date}-${start}`, employeeId: employee.id, date,
  startMinutes: start * 60, endMinutes: end * 60,
  pauseMinutes: 0, paidMinutes: (end - start) * 60,
  shiftType: "CUSTOM", generated: false,
});
const validate = (shifts: Shift[], extra: Partial<Employee> = {}) => validateSchedule([
  { ...employee, targetMinutes: shifts.reduce((sum, s) => sum + s.paidMinutes, 0), ...extra },
], shifts);

describe("Split-shift validation", () => {
  it("counts each calendar day once regardless of input order or duplicate shifts", () => {
    expect(maxConsecutiveRun(["2026-09-03", "2026-09-02", "2026-09-01", "2026-09-02", "2026-09-03"])).toBe(3);
    expect(maxConsecutiveRun([])).toBe(0);
    expect(maxConsecutiveRun(["2026-09-01", "2026-09-03", "2026-09-03"])).toBe(1);
  });

  it("rejects seven consecutive days even when every day contains two shifts", () => {
    const shifts = Array.from({ length: 7 }, (_, i) => {
      const date = `2026-09-0${i + 1}`;
      return [shift(date, 10, 13), shift(date, 17, 20)];
    }).flat();
    const result = validate(shifts);
    expect(result.summaries[0].maxConsecutiveDays).toBe(7);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes("quá 6 ngày"))).toBe(true);
  });

  it("rejects a daily total above the employee limit across separate pieces", () => {
    const shifts = [shift("2026-09-01", 10, 15), shift("2026-09-01", 16, 21)];
    expect(validate(shifts).errors.some(e => e.message.includes("Quá 9 giờ"))).toBe(true);
    expect(validate(shifts, { isOwner: true }).valid).toBe(true);
    expect(validate([shifts[0], shift("2026-09-01", 16, 22)], { isOwner: true }).valid).toBe(false);
  });

  it("accepts split shifts exactly at the daily limit", () => {
    expect(validate([shift("2026-09-01", 10, 14), shift("2026-09-01", 16, 21)]).valid).toBe(true);
  });

  it("detects overlapping later pieces even after a separate morning piece", () => {
    const result = validate([
      shift("2026-09-01", 8, 10),
      shift("2026-09-01", 15, 18),
      shift("2026-09-01", 17, 20),
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.filter(e => e.message.includes("nhiều hơn một ca"))).toHaveLength(1);
  });
});
