import { describe, expect, it } from "vitest";
import { generateSchedule, minCoverageOver } from "../scheduler";
import { createInitialSchedule } from "../sampleData";
import { analyzeServiceCoverage, serviceCoverageErrors } from "../serviceCoverage";
import { monthlyTargetMinutes } from "../contract";
import { validateSchedule } from "../validation";
import { updateShiftTimes } from "../shiftOps";
import type { Employee, Shift } from "../../types";
import { tryGenerateServiceSchedule } from "../serviceScheduler";
import { DEFAULT_WORK_HOURS, resolveDay } from "../workHours";
import { publicHolidays } from "../holidays";

describe("Family Quan service breaks", () => {
  it("does not leave a long service shift without another service worker to cover its break", () => {
    const schedule = createInitialSchedule();
    const shifts = generateSchedule(schedule);
    const serviceIds = new Set(schedule.employees.filter((e) => e.workRole === "SERVICE").map((e) => e.id));
    const service = shifts.filter((shift) => serviceIds.has(shift.employeeId));
    const uncovered = service.filter((shift) => shift.pauseMinutes > 0 && !service.some((other) =>
      other.employeeId !== shift.employeeId && other.date === shift.date &&
      Math.min(other.endMinutes, shift.endMinutes) - Math.max(other.startMinutes, shift.startMinutes) >= shift.pauseMinutes,
    ));
    expect(uncovered.map((shift) => `${shift.date}: ${shift.employeeId}`)).toEqual([]);
  });

  for (const month of [2, 9, 10, 11]) {
    it(`covers every open minute including breaks, without changing contracts, month ${month}`, () => {
      const schedule = { ...createInitialSchedule(), month };
      schedule.shifts = generateSchedule(schedule);
      const days = analyzeServiceCoverage(schedule);
      expect(serviceCoverageErrors(days)).toEqual([]);
      expect(days.every((day) => day.ok && day.minStaff >= 1)).toBe(true);
      const validation = validateSchedule(schedule.employees, schedule.shifts, 2026, days.length);
      expect(validation.errors).toEqual([]);
      for (const emp of schedule.employees.filter((e) => e.workRole === "SERVICE")) {
        const own = schedule.shifts.filter((s) => s.employeeId === emp.id);
        expect(own.reduce((sum, s) => sum + s.paidMinutes, 0)).toBe(monthlyTargetMinutes(emp, days.length));
      }
      for (const day of days) for (const pause of day.breaks) {
        expect(pause.covered).toBe(true);
        expect(pause.coveringEmployeeIds).not.toContain(pause.employeeId);
        expect(pause.coveringEmployeeIds.length).toBeGreaterThan(0);
      }
      const serviceIds = new Set(schedule.employees.filter((e) => e.workRole === "SERVICE").map((e) => e.id));
      for (const day of days) {
        expect(minCoverageOver(schedule.shifts.filter((s) => s.date === day.date && serviceIds.has(s.employeeId)), 720, 1320)).toBe(1);
      }
    });
  }

  const primary: Shift = {
    id: "primary", employeeId: "ma-1", date: "2026-09-01", startMinutes: 720, endMinutes: 1320,
    pauseMinutes: 60, pauseStartMinutes: 960, paidMinutes: 540, shiftType: "EARLY", generated: true,
  };
  const relief: Shift = {
    id: "relief", employeeId: "ma-3", date: "2026-09-01", startMinutes: 960, endMinutes: 1020,
    pauseMinutes: 0, paidMinutes: 60, isBreakCover: true, shiftType: "LATE", generated: true,
  };
  const firstDay = (shifts: Shift[]) => analyzeServiceCoverage({ ...createInitialSchedule(), shifts })[0];

  it("reports the exact gap when the relief employee is removed; kitchen cannot silently replace service", () => {
    expect(firstDay([primary, relief]).ok).toBe(true);
    const day = firstDay([primary, { ...relief, employeeId: "ma-0" }]);
    expect(day.gaps).toEqual([{ startMinutes: 960, endMinutes: 1020 }]);
    expect(day.breaks[0].covered).toBe(false);
    expect(serviceCoverageErrors([day])).toHaveLength(1);
  });

  it("does not count two service employees taking the same break as cover", () => {
    const day = firstDay([primary, { ...primary, id: "second", employeeId: "ma-3" }]);
    expect(day.gaps).toEqual([{ startMinutes: 960, endMinutes: 1020 }]);
    expect(day.breaks.every((pause) => !pause.covered)).toBe(true);
  });

  it("detects a one-minute handover gap, and recomputes coverage after editing", () => {
    const late = updateShiftTimes(relief, { startMinutes: 961 });
    expect(firstDay([primary, late]).gaps).toEqual([{ startMinutes: 960, endMinutes: 961 }]);
    expect(firstDay([primary, updateShiftTimes(late, { startMinutes: 960 })]).ok).toBe(true);
  });

  it("does not certify legacy shifts with an unspecified break time", () => {
    const day = firstDay([{ ...primary, pauseStartMinutes: undefined }, relief]);
    expect(day.ok).toBe(false);
    expect(serviceCoverageErrors([day])[0].employeeId).toBe(primary.employeeId);
  });

  it("clears an obsolete break after changing the shift window", () => {
    const edited = updateShiftTimes(primary, { endMinutes: 950 });
    expect(edited.pauseStartMinutes).toBeUndefined();
  });

  it("respects personal availability and a weekly workday limit", () => {
    const schedule = createInitialSchedule();
    schedule.employees = schedule.employees.map((e) => e.id === "ma-3"
      ? { ...e, vacationDates: ["2026-09-05"], maxDaysPerWeek: 4 } : e);
    schedule.shifts = generateSchedule(schedule);
    expect(analyzeServiceCoverage(schedule).every((day) => day.ok)).toBe(true);
    expect(schedule.shifts.some((s) => s.employeeId === "ma-3" && s.date === "2026-09-05")).toBe(false);
  });

  it("rechecks relief availability after employee settings change", () => {
    const schedule = { ...createInitialSchedule(), shifts: [primary, relief] };
    expect(validateSchedule(schedule.employees, schedule.shifts, 2026, 30).valid).toBe(true);
    schedule.employees = schedule.employees.map((e) => e.id === relief.employeeId
      ? { ...e, vacationDates: [relief.date] } : e);
    const day = analyzeServiceCoverage(schedule)[0];
    expect(day.ok).toBe(false);
    expect(day.gaps).toEqual([{ startMinutes: 960, endMinutes: 1020 }]);
    const result = validateSchedule(schedule.employees, schedule.shifts, 2026, 30);
    expect(result.valid).toBe(false);
    expect(result.errors.filter((error) => error.severity !== "warning")).toEqual([
      expect.objectContaining({ employeeId: relief.employeeId, date: relief.date,
        message: expect.stringContaining("ngày không thể làm") }),
    ]);
  });

  it("rechecks weekly workday limits after employee settings change", () => {
    const schedule = createInitialSchedule();
    schedule.shifts = generateSchedule(schedule);
    schedule.employees = schedule.employees.map((e) => e.id === "ma-5" ? { ...e, maxDaysPerWeek: 1 } : e);
    expect(validateSchedule(schedule.employees, schedule.shifts, 2026, 30).valid).toBe(false);
  });

  it("reports uncovered opening hours even if generation returns no shifts", () => {
    const days = analyzeServiceCoverage(createInitialSchedule());
    expect(days).toHaveLength(30);
    expect(days.every((day) => !day.ok)).toBe(true);
    expect(serviceCoverageErrors(days)).toHaveLength(30);
  });

  it("places surplus hours where employees are available, not on a fixed busy day", () => {
    const emp = (id: string, hours: number, weekday: "monday" | "saturday"): Employee => ({
      id, name: id, employmentType: "MINIJOB", workRole: "SERVICE", targetMinutes: hours * 60,
      availableWeekdays: [weekday],
    });
    const employees = [emp("a", 9, "saturday"), emp("b", 1, "saturday"), emp("c", 6, "monday"), emp("d", 6, "monday")];
    const dates = ["2026-09-05", "2026-09-07"];
    const shifts = tryGenerateServiceSchedule(employees, dates,
      (date) => resolveDay(DEFAULT_WORK_HOURS, date, publicHolidays(2026)));
    expect(shifts).toBeDefined();
    expect(shifts!.filter((s) => s.date === dates[0]).reduce((sum, s) => sum + s.paidMinutes, 0)).toBe(600);
    expect(shifts!.filter((s) => s.date === dates[1]).reduce((sum, s) => sum + s.paidMinutes, 0)).toBe(720);
  });
});
