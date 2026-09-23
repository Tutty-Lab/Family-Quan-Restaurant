import type { Employee, Schedule, Shift, WorkRole } from "../types";
import { datesOfMonth } from "./demand";
import { mayWorkOn } from "./availability";
import { publicHolidays } from "./holidays";
import type { DayWindow } from "./workHours";
import { resolveDay } from "./workHours";
import { minutesToTime } from "./time";
import type { ValidationError } from "./validation";

export function hasValidBreak(shift: Shift): boolean {
  const start = shift.pauseStartMinutes;
  return start != null && Number.isInteger(start) && shift.pauseMinutes > 0 &&
    start > shift.startMinutes && start + shift.pauseMinutes < shift.endMinutes &&
    start - shift.startMinutes <= 6 * 60 && shift.endMinutes - start - shift.pauseMinutes <= 6 * 60;
}

export function isWorkingAt(shift: Shift, minute: number): boolean {
  return shift.startMinutes <= minute && minute < shift.endMinutes &&
    !(hasValidBreak(shift) && minute >= shift.pauseStartMinutes! && minute < shift.pauseStartMinutes! + shift.pauseMinutes);
}

export function isServiceCoverAt(shift: Shift, minute: number): boolean {
  return (shift.serviceCoverWindows ?? []).some((w) => w.startMinutes <= minute && minute < w.endMinutes);
}

export function isWorkingInRoleAt(shift: Shift, employee: Employee, role: WorkRole, minute: number): boolean {
  const assignedRole = employee.isOwner && employee.workRole === "KITCHEN" && isServiceCoverAt(shift, minute)
    ? "SERVICE" : employee.workRole;
  return assignedRole === role && isWorkingAt(shift, minute);
}

export type ServiceBreak = {
  shiftId: string;
  employeeId: string;
  start?: number;
  end?: number;
  coveringEmployeeIds: string[];
  covered: boolean;
};

export type ServiceDayCoverage = {
  date: string;
  minStaff: number;
  gaps: DayWindow[];
  breaks: ServiceBreak[];
  ok: boolean;
  ownerCovers: { employeeId: string; start: number; end: number }[];
};

function segments(shifts: Shift[], from: number, to: number, working: (s: Shift, t: number) => boolean) {
  const points = [...new Set([from, to, ...shifts.flatMap((s) => [s.startMinutes, s.endMinutes,
    ...(hasValidBreak(s) ? [s.pauseStartMinutes!, s.pauseStartMinutes! + s.pauseMinutes] : []),
    ...(s.serviceCoverWindows ?? []).flatMap((w) => [w.startMinutes, w.endMinutes]),
  ]).filter((t) => t > from && t < to)])].sort((a, b) => a - b);
  return points.slice(0, -1).map((start, i) => ({
    startMinutes: start,
    endMinutes: points[i + 1],
    staff: [...new Set(shifts.filter((s) => working(s, start)).map((s) => s.employeeId))],
  }));
}

export function hasContinuousRoleCoverage(employees: Employee[], shifts: Shift[], date: string, blocks: DayWindow[], role: WorkRole): boolean {
  const byId = new Map(employees.map((e) => [e.id, e]));
  const own = shifts.filter((s) => s.date === date && byId.has(s.employeeId) && mayWorkOn(byId.get(s.employeeId)!, date));
  if (own.some((s) => byId.get(s.employeeId)?.workRole === role && s.pauseMinutes > 0 && !hasValidBreak(s))) return false;
  return blocks.every((block) => segments(own, block.startMinutes, block.endMinutes,
    (s, minute) => isWorkingInRoleAt(s, byId.get(s.employeeId)!, role, minute)).every((part) => part.staff.length > 0));
}

export function analyzeServiceCoverage(schedule: Schedule): ServiceDayCoverage[] {
  return analyzeRoleCoverage(schedule, "SERVICE");
}

export function analyzeRoleCoverage(schedule: Schedule, role: WorkRole): ServiceDayCoverage[] {
  const service = schedule.employees.filter((e) => e.workRole === role ||
    (role === "SERVICE" && e.isOwner && e.workRole === "KITCHEN"));
  const byId = new Map(service.map((e) => [e.id, e]));
  const working = (s: Shift, minute: number) => isWorkingInRoleAt(s, byId.get(s.employeeId)!, role, minute);
  if (!schedule.employees.some((e) => e.workRole)) return [];
  const holidays = publicHolidays(schedule.year);
  const overrides = Object.fromEntries(schedule.dateOverrides.map((o) => [o.date, o]));
  return datesOfMonth(schedule.year, schedule.month).flatMap((date) => {
    const day = resolveDay(schedule.workHours, date, holidays, overrides);
    if (day.closed) return [];
    const availableIds = new Set(service.filter((e) => mayWorkOn(e, date)).map((e) => e.id));
    const shifts = schedule.shifts.filter((s) => s.date === date && availableIds.has(s.employeeId));
    const spans = day.blocks.flatMap((block) => segments(shifts, block.startMinutes, block.endMinutes, working));
    const gaps: DayWindow[] = [];
    for (const span of spans.filter((s) => s.staff.length === 0)) {
      const previous = gaps[gaps.length - 1];
      if (previous?.endMinutes === span.startMinutes) previous.endMinutes = span.endMinutes;
      else gaps.push({ startMinutes: span.startMinutes, endMinutes: span.endMinutes });
    }
    const breaks = shifts.filter((s) => s.pauseMinutes > 0 && byId.get(s.employeeId)?.workRole === role).map((shift): ServiceBreak => {
      if (!hasValidBreak(shift)) return {
        shiftId: shift.id, employeeId: shift.employeeId, coveringEmployeeIds: [], covered: false,
      };
      const start = shift.pauseStartMinutes!;
      const end = start + shift.pauseMinutes;
      const others = shifts.filter((s) => s.employeeId !== shift.employeeId && (s.pauseMinutes === 0 || hasValidBreak(s)));
      const relief = day.blocks.flatMap((block) => {
        const from = Math.max(start, block.startMinutes);
        const to = Math.min(end, block.endMinutes);
        return to > from ? segments(others, from, to, working) : [];
      });
      return {
        shiftId: shift.id, employeeId: shift.employeeId, start, end,
        coveringEmployeeIds: [...new Set(relief.flatMap((part) => part.staff))],
        covered: relief.every((part) => part.staff.length > 0),
      };
    });
    return [{ date, minStaff: spans.length ? Math.min(...spans.map((s) => s.staff.length)) : 0,
      gaps, breaks, ok: gaps.length === 0 && breaks.every((b) => b.covered),
      ownerCovers: shifts.filter((s) => byId.get(s.employeeId)?.isOwner && byId.get(s.employeeId)?.workRole === "KITCHEN")
        .flatMap((s) => (s.serviceCoverWindows ?? []).map((w) => ({ employeeId: s.employeeId, start: w.startMinutes, end: w.endMinutes }))),
    }];
  });
}

export function serviceCoverageErrors(days: ServiceDayCoverage[], role: WorkRole = "SERVICE"): ValidationError[] {
  const label = role === "KITCHEN" ? "bếp" : "bồi";
  return days.flatMap((day) => [
    ...day.gaps.map((gap) => ({ date: day.date,
      message: `${day.date}: không có ${label} đang làm ${minutesToTime(gap.startMinutes)}–${minutesToTime(gap.endMinutes)} (đã trừ giờ nghỉ).`,
    })),
    ...day.breaks.filter((b) => b.start == null).map((b) => ({ date: day.date, employeeId: b.employeeId,
      message: `${day.date}: ca ${label} chưa có giờ nghỉ hợp lệ. Cần chọn giờ nghỉ và bố trí người thay.`,
    })),
  ]);
}
