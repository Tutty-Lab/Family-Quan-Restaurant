import { describe, expect, it } from "vitest";
import type { Employee, Shift } from "../../types";
import { replaceOneHourReliefWithOwner } from "../ownerRelief";
import { createInitialSchedule } from "../sampleData";
import { generateSchedule } from "../scheduler";
import { analyzeRoleCoverage, isWorkingInRoleAt } from "../serviceCoverage";
import { validateSchedule } from "../validation";
import { DEFAULT_WORK_HOURS, resolveDay } from "../workHours";
import { publicHolidays } from "../holidays";
import { updateShiftTimes } from "../shiftOps";

const dates = ["2026-09-01", "2026-09-02"];
const dayOf = (date: string) => resolveDay(DEFAULT_WORK_HOURS, date, publicHolidays(2026));
const employees: Employee[] = [
  { id: "owner", name: "Owner", isOwner: true, workRole: "KITCHEN", employmentType: "VOLLZEIT", targetMinutes: 1080 },
  { id: "cook", name: "Cook", workRole: "KITCHEN", employmentType: "VOLLZEIT", targetMinutes: 1080 },
  { id: "server", name: "Server", workRole: "SERVICE", employmentType: "VOLLZEIT", targetMinutes: 1080 },
  { id: "relief", name: "Relief", workRole: "SERVICE", employmentType: "MINIJOB", targetMinutes: 240 },
];
const long = (employeeId: string, date: string, pause: number): Shift => ({
  id: `${employeeId}-${date}`, employeeId, date, startMinutes: 720, endMinutes: 1320,
  paidMinutes: 540, pauseMinutes: 60, pauseStartMinutes: pause,
  generated: true, shiftType: "EARLY",
});
function fixture(): Shift[] {
  return dates.flatMap((date, i) => [long("owner", date, 900), long("cook", date, 960), long("server", date, 960),
    { ...long("relief", date, 0), startMinutes: i ? 840 : 960, endMinutes: 1020,
      paidMinutes: i ? 180 : 60, pauseMinutes: 0, pauseStartMinutes: undefined, isBreakCover: !i },
  ]);
}

describe("Owner covers one-hour service relief", () => {
  it("records the duty once, redistributes the paid hour and staggers kitchen breaks", () => {
    const before = fixture();
    const snapshot = structuredClone(before);
    const shifts = replaceOneHourReliefWithOwner(employees, before, dayOf);
    expect(before).toEqual(snapshot);
    expect(shifts).toHaveLength(before.length - 1);
    expect(shifts.some((s) => s.employeeId === "relief" && s.date === dates[0])).toBe(false);
    expect(shifts.find((s) => s.employeeId === "relief")).toMatchObject({ paidMinutes: 240 });
    const owner = shifts.find((s) => s.id === `owner-${dates[0]}`)!;
    expect(owner.serviceCoverWindows).toEqual([{ startMinutes: 960, endMinutes: 1020 }]);
    expect(owner.paidMinutes).toBe(540);
    const cook = shifts.find((s) => s.id === `cook-${dates[0]}`)!;
    expect(Math.abs(owner.pauseStartMinutes! - cook.pauseStartMinutes!)).toBeGreaterThanOrEqual(60);
    expect(isWorkingInRoleAt(owner, employees[0], "KITCHEN", 960)).toBe(false);
    expect(isWorkingInRoleAt(owner, employees[0], "SERVICE", 960)).toBe(true);
    expect(isWorkingInRoleAt(owner, employees[0], "SERVICE", 1020)).toBe(false);
    expect(validateSchedule(employees, shifts).errors).toEqual([]);
    for (const role of ["KITCHEN", "SERVICE"] as const) {
      const days = analyzeRoleCoverage({ ...createInitialSchedule(), employees, shifts }, role).filter((d) => dates.includes(d.date));
      expect(days.every((d) => d.ok)).toBe(true);
    }
  });

  it("keeps the one-hour employee when there is no kitchen replacement", () => {
    const shifts = fixture().filter((s) => s.employeeId !== "cook" || s.date !== dates[0]);
    expect(replaceOneHourReliefWithOwner(employees, shifts, dayOf)).toEqual(shifts);
  });

  it("does not discard contracted hours when there is no shift to extend", () => {
    const shifts = fixture().filter((s) => s.employeeId !== "relief" || s.date === dates[0]);
    expect(replaceOneHourReliefWithOwner(employees, shifts, dayOf)).toEqual(shifts);
  });

  it("preserves manual and fixed duties", () => {
    const manual = fixture().map((s) => s.employeeId === "relief" ? { ...s, generated: false } : s);
    expect(replaceOneHourReliefWithOwner(employees, manual, dayOf)).toEqual(manual);
    const fixed = employees.map((e) => e.id === "relief" ? { ...e, fixedShift: { startMinutes: 960, endMinutes: 1020 } } : e);
    const shifts = fixture();
    expect(replaceOneHourReliefWithOwner(fixed, shifts, dayOf)).toEqual(shifts);
  });

  it("flags edits that overlap the owner's service duty or kitchen colleague's pause", () => {
    const shifts = replaceOneHourReliefWithOwner(employees, fixture(), dayOf);
    const owner = shifts.find((s) => s.id === `owner-${dates[0]}`)!;
    const overlap = shifts.map((s) => s.id === owner.id ? updateShiftTimes(s, { pauseStartMinutes: 960 }) : s);
    expect(validateSchedule(employees, overlap).errors.some((e) => e.message.includes("giờ chủ phụ bồi không hợp lệ"))).toBe(true);
    const simultaneous = shifts.map((s) => s.id === `cook-${dates[0]}` ? { ...s, pauseStartMinutes: owner.pauseStartMinutes } : s);
    expect(validateSchedule(employees, simultaneous).errors.some((e) => e.message.includes("giờ nghỉ của chủ trùng"))).toBe(true);
    const noCook = shifts.filter((s) => s.employeeId !== "cook" || s.date !== dates[0]);
    expect(analyzeRoleCoverage({ ...createInitialSchedule(), employees, shifts: noCook }, "KITCHEN")[0].ok).toBe(false);
  });

  it("uses owner relief for the actual September team without losing target hours", () => {
    const schedule = createInitialSchedule();
    schedule.shifts = generateSchedule(schedule);
    const owners = schedule.shifts.filter((s) => s.serviceCoverWindows?.length);
    expect(owners.length).toBeGreaterThan(0);
    expect(schedule.shifts.filter((s) => s.paidMinutes === 60)).toHaveLength(0);
    expect(validateSchedule(schedule.employees, schedule.shifts, 2026, 30).errors).toEqual([]);
    for (const role of ["KITCHEN", "SERVICE"] as const) expect(analyzeRoleCoverage(schedule, role).every((d) => d.ok)).toBe(true);
  });
});
