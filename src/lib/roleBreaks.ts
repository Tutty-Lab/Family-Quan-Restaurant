import type { Employee, Shift } from "../types";
import type { DayWindow } from "./workHours";
import { hasValidBreak, isServiceCoverAt, isWorkingAt } from "./serviceCoverage";
import { daysBetween } from "./consecutive";

/** Shift an existing short duty within its block when it starts too late to
 * cover a colleague's break. Never add hours, workdays, or relief-only visits. */
export function arrangeCoveredBreaks(employees: Employee[], shifts: Shift[], blocks: DayWindow[], allShifts: Shift[]): boolean {
  const owners = new Set(employees.filter((e) => e.isOwner).map((e) => e.id));
  if (assignCoveredBreaks(shifts, blocks, owners)) return true;
  for (const shift of shifts) {
    const employee = employees.find((e) => e.id === shift.employeeId);
    if (!employee || employee.isOwner || employee.fixedShift || employee.employmentType === "AZUBI" ||
        !shift.generated || shift.pauseMinutes !== 0) continue;
    const block = blocks.find((b) => b.startMinutes <= shift.startMinutes && b.endMinutes >= shift.endMinutes);
    if (!block) continue;
    const duration = shift.endMinutes - shift.startMinutes;
    const starts: number[] = [];
    for (let start = block.startMinutes; start + duration <= block.endMinutes; start += 15) starts.push(start);
    starts.sort((a, b) => Math.abs(a - shift.startMinutes) - Math.abs(b - shift.startMinutes));
    for (const start of starts) {
      if (start === shift.startMinutes) continue;
      const end = start + duration;
      const conflict = allShifts.some((other) => {
        if (other.id === shift.id || other.employeeId !== shift.employeeId) return false;
        const days = daysBetween(shift.date, other.date);
        if (days === 0) return start < other.endMinutes && other.startMinutes < end;
        if (days > 0) return days * 1440 + other.startMinutes - end < 660;
        return -days * 1440 + start - other.endMinutes < 660;
      });
      if (conflict) continue;
      const trial = shifts.map((s): Shift => s.id === shift.id ? { ...s, startMinutes: start, endMinutes: end,
        shiftType: start === block.startMinutes ? "EARLY" : end === block.endMinutes ? "LATE" : "CUSTOM" } : { ...s });
      if (!assignCoveredBreaks(trial, blocks, owners)) continue;
      trial.forEach((s, i) => Object.assign(shifts[i], s));
      return true;
    }
  }
  return false;
}

/** Place breaks together, so two colleagues never cover each other's break
 * while both are off. Failure leaves the input intact for validation to flag. */
export function assignCoveredBreaks(shifts: Shift[], blocks: DayWindow[], ownerIds: ReadonlySet<string> = new Set()): boolean {
  const trial = shifts.map((s) => ({ ...s }));
  const pending = trial.filter((s) => s.pauseMinutes > 0 && !hasValidBreak(s));
  const covered = () => blocks.every((block) => {
    const points = new Set([block.startMinutes, ...trial.flatMap((s) => [
      s.startMinutes, s.endMinutes,
      ...(hasValidBreak(s) ? [s.pauseStartMinutes!, s.pauseStartMinutes! + s.pauseMinutes] : []),
      ...(s.serviceCoverWindows ?? []).flatMap((w) => [w.startMinutes, w.endMinutes]),
    ]).filter((t) => t >= block.startMinutes && t < block.endMinutes)]);
    return [...points].every((t) => trial.some((s) => isWorkingAt(s, t) && !isServiceCoverAt(s, t)));
  });
  let visits = 0;
  function place(index: number): boolean {
    if (trial.some((s) => ownerIds.has(s.employeeId) && hasValidBreak(s) && trial.some((other) =>
      other.employeeId !== s.employeeId && hasValidBreak(other) &&
      s.pauseStartMinutes! < other.pauseStartMinutes! + other.pauseMinutes &&
      other.pauseStartMinutes! < s.pauseStartMinutes! + s.pauseMinutes))) return false;
    if (trial.some((s) => hasValidBreak(s) && (s.serviceCoverWindows ?? []).some((w) =>
      w.startMinutes < s.pauseStartMinutes! + s.pauseMinutes && s.pauseStartMinutes! < w.endMinutes))) return false;
    if (++visits > 10_000 || !covered()) return false;
    if (index === pending.length) return true;
    const shift = pending[index];
    const from = Math.max(shift.startMinutes + 1, shift.endMinutes - shift.pauseMinutes - 360);
    const to = Math.min(shift.endMinutes - shift.pauseMinutes - 1, shift.startMinutes + 360);
    for (let start = from; start <= to; start++) {
      shift.pauseStartMinutes = start;
      if (place(index + 1)) return true;
    }
    shift.pauseStartMinutes = undefined;
    return false;
  }
  if (!place(0)) return false;
  trial.forEach((s, i) => {
    if (s.pauseStartMinutes != null) shifts[i].pauseStartMinutes = s.pauseStartMinutes;
  });
  return true;
}
