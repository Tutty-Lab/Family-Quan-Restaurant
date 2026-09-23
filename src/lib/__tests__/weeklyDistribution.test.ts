import { describe, expect, it } from "vitest";
import { createInitialSchedule } from "../sampleData";
import { generateSchedule } from "../scheduler";
import { datesOfMonth } from "../demand";
import { publicHolidays } from "../holidays";
import { resolveDay } from "../workHours";
import { isPartTime, partTimeWeeks, weeklyDistributionWarnings } from "../weeklyDistribution";
import { weekStartOf } from "../weeks";
import { validateSchedule } from "../validation";
import { analyzeRoleCoverage } from "../serviceCoverage";

describe("Part-time weekly distribution", () => {
  for (let month = 1; month <= 12; month++) it(`keeps regular visits in every available week, month ${month}`, () => {
    const schedule = { ...createInitialSchedule(), month };
    const dates = datesOfMonth(schedule.year, month);
    const dayOf = (date: string) => resolveDay(schedule.workHours, date, publicHolidays(schedule.year));
    schedule.shifts = generateSchedule(schedule);
    expect(schedule.shifts.filter((s) => s.endMinutes === 22 * 60 && s.startMinutes >= 19 * 60)).toEqual([]);
    if (month === 9) {
      const ids = new Set(schedule.employees.filter(isPartTime).map((e) => e.id));
      const visits = ["2026-09-28", "2026-09-29", "2026-09-30"].map((date) => new Set(schedule.shifts.filter((s) => s.date === date && ids.has(s.employeeId)).map((s) => s.employeeId)).size);
      expect(visits.every((n) => n >= 1 && n <= 2), JSON.stringify(visits)).toBe(true);
      const added = schedule.shifts.filter((s) => s.date >= "2026-09-28" && ids.has(s.employeeId));
      expect(added).toHaveLength(4);
      expect(added.every((s) => s.startMinutes === 20 * 60 - s.paidMinutes && s.endMinutes === 20 * 60)).toBe(true);
    }
    for (const employee of schedule.employees.filter(isPartTime)) {
      const counts = partTimeWeeks(employee, dates, dayOf).map((w) => ({ week: w.week, target: w.target,
        count: new Set(schedule.shifts.filter((s) => s.employeeId === employee.id && weekStartOf(s.date) === w.week).map((s) => s.date)).size,
      }));
      expect(counts.filter((w) => w.count < 1), `${employee.name}: ${JSON.stringify(counts)}`).toEqual([]);
      if (month === 9) expect(counts.every((w) => w.count >= w.target)).toBe(true);
    }
    expect(validateSchedule(schedule.employees, schedule.shifts, 2026, dates.length).errors).toEqual([]);
    for (const role of ["KITCHEN", "SERVICE"] as const) expect(analyzeRoleCoverage(schedule, role).every((d) => d.ok)).toBe(true);
    expect(weeklyDistributionWarnings(schedule.employees, schedule.shifts, dates, dayOf)).toEqual([]);
  });

  it("does not demand work during a whole week of leave, and respects a one-day cap", () => {
    const schedule = createInitialSchedule();
    const dates = datesOfMonth(2026, 9);
    const dayOf = (date: string) => resolveDay(schedule.workHours, date, publicHolidays(2026));
    const employee = { ...schedule.employees[3], maxDaysPerWeek: 1,
      vacationDates: dates.filter((d) => weekStartOf(d) === "2026-09-07") };
    const weeks = partTimeWeeks(employee, dates, dayOf);
    expect(weeks.every((w) => w.target === 1)).toBe(true);
    expect(weeks.some((w) => w.week === "2026-09-07")).toBe(false);
    expect(weeklyDistributionWarnings([employee], [], dates, dayOf)).toHaveLength(4);
  });
});
