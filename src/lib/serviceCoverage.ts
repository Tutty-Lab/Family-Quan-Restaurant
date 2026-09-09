import type { Schedule, Shift } from "../types";
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
};

function segments(shifts: Shift[], from: number, to: number) {
  const points = [...new Set([from, to, ...shifts.flatMap((s) => [s.startMinutes, s.endMinutes,
    ...(hasValidBreak(s) ? [s.pauseStartMinutes!, s.pauseStartMinutes! + s.pauseMinutes] : []),
  ]).filter((t) => t > from && t < to)])].sort((a, b) => a - b);
  return points.slice(0, -1).map((start, i) => ({
    startMinutes: start,
    endMinutes: points[i + 1],
    staff: [...new Set(shifts.filter((s) => isWorkingAt(s, start)).map((s) => s.employeeId))],
  }));
}

export function analyzeServiceCoverage(schedule: Schedule): ServiceDayCoverage[] {
  const service = schedule.employees.filter((e) => e.workRole === "SERVICE");
  if (!schedule.employees.some((e) => e.workRole)) return [];
  const holidays = publicHolidays(schedule.year);
  const overrides = Object.fromEntries(schedule.dateOverrides.map((o) => [o.date, o]));
  return datesOfMonth(schedule.year, schedule.month).flatMap((date) => {
    const day = resolveDay(schedule.workHours, date, holidays, overrides);
    if (day.closed) return [];
    const availableIds = new Set(service.filter((e) => mayWorkOn(e, date)).map((e) => e.id));
    const shifts = schedule.shifts.filter((s) => s.date === date && availableIds.has(s.employeeId));
    const spans = day.blocks.flatMap((block) => segments(shifts, block.startMinutes, block.endMinutes));
    const gaps: DayWindow[] = [];
    for (const span of spans.filter((s) => s.staff.length === 0)) {
      const previous = gaps[gaps.length - 1];
      if (previous?.endMinutes === span.startMinutes) previous.endMinutes = span.endMinutes;
      else gaps.push({ startMinutes: span.startMinutes, endMinutes: span.endMinutes });
    }
    const breaks = shifts.filter((s) => s.pauseMinutes > 0).map((shift): ServiceBreak => {
      if (!hasValidBreak(shift)) return {
        shiftId: shift.id, employeeId: shift.employeeId, coveringEmployeeIds: [], covered: false,
      };
      const start = shift.pauseStartMinutes!;
      const end = start + shift.pauseMinutes;
      const others = shifts.filter((s) => s.employeeId !== shift.employeeId && (s.pauseMinutes === 0 || hasValidBreak(s)));
      const relief = day.blocks.flatMap((block) => {
        const from = Math.max(start, block.startMinutes);
        const to = Math.min(end, block.endMinutes);
        return to > from ? segments(others, from, to) : [];
      });
      return {
        shiftId: shift.id, employeeId: shift.employeeId, start, end,
        coveringEmployeeIds: [...new Set(relief.flatMap((part) => part.staff))],
        covered: relief.every((part) => part.staff.length > 0),
      };
    });
    return [{ date, minStaff: spans.length ? Math.min(...spans.map((s) => s.staff.length)) : 0,
      gaps, breaks, ok: gaps.length === 0 && breaks.every((b) => b.covered) }];
  });
}

export function serviceCoverageErrors(days: ServiceDayCoverage[]): ValidationError[] {
  return days.flatMap((day) => [
    ...day.gaps.map((gap) => ({ date: day.date,
      message: `${day.date}: không có bồi đang làm ${minutesToTime(gap.startMinutes)}–${minutesToTime(gap.endMinutes)} (đã trừ giờ nghỉ).`,
    })),
    ...day.breaks.filter((b) => b.start == null).map((b) => ({ date: day.date, employeeId: b.employeeId,
      message: `${day.date}: ca bồi chưa có giờ nghỉ hợp lệ. Cần chọn giờ nghỉ và bố trí người thay.`,
    })),
  ]);
}
