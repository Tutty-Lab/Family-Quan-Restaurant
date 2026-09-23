import { describe, expect, it } from "vitest";
import { createInitialSchedule } from "../sampleData";
import { generateSchedule } from "../scheduler";
import { analyzeRoleCoverage, serviceCoverageErrors } from "../serviceCoverage";
import { arrangeCoveredBreaks, assignCoveredBreaks } from "../roleBreaks";
import { validateSchedule } from "../validation";
import type { Employee, Shift } from "../../types";

describe("Continuous kitchen and service coverage including breaks", () => {
  for (let month = 1; month <= 12; month++) it(`covers both roles in month ${month}`, () => {
    const schedule = { ...createInitialSchedule(), month };
    schedule.shifts = generateSchedule(schedule);
    for (const role of ["KITCHEN", "SERVICE"] as const) {
      const days = analyzeRoleCoverage(schedule, role);
      expect(serviceCoverageErrors(days, role)).toEqual([]);
      expect(days.every((d) => d.ok)).toBe(true);
      expect(validateSchedule(schedule.employees, schedule.shifts, schedule.year, days.length).errors).toEqual([]);
      for (const day of days) {
        const own = schedule.shifts.filter((s) => s.date === day.date);
        for (let minute = 720; minute < 1320; minute++) {
          // Independent minute-by-minute check, including the last minute and
          // exact break boundaries, rather than relying on the analyzer alone.
          const working = own.some((s) => {
            const employee = schedule.employees.find((e) => e.id === s.employeeId)!;
            const covering = employee.isOwner && employee.workRole === "KITCHEN" &&
              s.serviceCoverWindows?.some((w) => w.startMinutes <= minute && minute < w.endMinutes);
            return (covering ? "SERVICE" : employee.workRole) === role && s.startMinutes <= minute && minute < s.endMinutes &&
              !(s.pauseMinutes > 0 && s.pauseStartMinutes! <= minute && minute < s.pauseStartMinutes! + s.pauseMinutes);
          });
          if (!working) throw new Error(`${role} uncovered at ${day.date}, minute ${minute}`);
        }
      }
    }
  });

  const long = (id: string): Shift => ({ id, employeeId: id, date: "2026-09-01",
    startMinutes: 720, endMinutes: 1320, paidMinutes: 540, pauseMinutes: 60,
    generated: true, shiftType: "EARLY" });
  const blocks = [{ startMinutes: 720, endMinutes: 1320 }];
  const team: Employee[] = [
    { id: "owner", name: "Owner", isOwner: true, employmentType: "VOLLZEIT", targetMinutes: 540 },
    { id: "relief", name: "Relief", employmentType: "MINIJOB", targetMinutes: 180 },
  ];
  const lateRelief = (): Shift => ({ ...long("relief"), startMinutes: 1140, endMinutes: 1320,
    paidMinutes: 180, pauseMinutes: 0, shiftType: "LATE" });

  it("moves a three-hour kitchen duty earlier instead of adding a one-hour visit", () => {
    const shifts = [long("owner"), lateRelief()];
    expect(arrangeCoveredBreaks(team, shifts, blocks, shifts)).toBe(true);
    expect(shifts).toHaveLength(2);
    expect(shifts[0].pauseStartMinutes).toBe(1080);
    expect(shifts[1]).toMatchObject({ startMinutes: 1080, endMinutes: 1260, paidMinutes: 180 });
  });

  it("preserves fixed and manually edited duties even if coverage is impossible", () => {
    const fixed = team.map((e) => e.id === "relief" ? { ...e, fixedShift: { startMinutes: 1140, endMinutes: 1320 } } : e);
    for (const employees of [team, fixed]) {
      const shifts = [long("owner"), { ...lateRelief(), generated: employees === fixed }];
      const before = structuredClone(shifts);
      expect(arrangeCoveredBreaks(employees, shifts, blocks, shifts)).toBe(false);
      expect(shifts).toEqual(before);
    }
  });

  it("staggers two long shifts' breaks without changing paid time", () => {
    const shifts = [long("a"), long("b")];
    expect(assignCoveredBreaks(shifts, blocks)).toBe(true);
    expect(Math.abs(shifts[0].pauseStartMinutes! - shifts[1].pauseStartMinutes!)).toBeGreaterThanOrEqual(60);
    expect(shifts.map((s) => s.paidMinutes)).toEqual([540, 540]);
  });

  it("does not invent coverage for a lone worker", () => {
    const shifts = [long("a")];
    expect(assignCoveredBreaks(shifts, blocks)).toBe(false);
    expect(shifts[0].pauseStartMinutes).toBeUndefined();
  });

  it("reports missing kitchen break times even when service is staffed", () => {
    const schedule = createInitialSchedule();
    schedule.shifts = [{ ...long("ma-0") }, { ...long("ma-1"), pauseStartMinutes: 960 }];
    const errors = serviceCoverageErrors(analyzeRoleCoverage(schedule, "KITCHEN"), "KITCHEN");
    expect(errors).toContainEqual(expect.objectContaining({
      employeeId: "ma-0", message: expect.stringContaining("ca bếp chưa có giờ nghỉ hợp lệ"),
    }));
  });
});
