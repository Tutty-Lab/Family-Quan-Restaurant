import type { Employee, Shift, WorkRole } from "../types";
import type { ResolvedDay } from "./workHours";
import { mayWorkOn } from "./availability";
import { daysBetween } from "./consecutive";
import { assignCoveredBreaks } from "./roleBreaks";
import { hasContinuousRoleCoverage, hasValidBreak, isWorkingInRoleAt } from "./serviceCoverage";

/** A redistribution may expose a one-hour service gap. Cover it with the
 * kitchen owner only after explicitly rescheduling non-overlapping breaks. */
export function coverShortServiceGapWithOwner(employees: Employee[], input: Shift[], date: string, day: ResolvedDay): Shift[] | undefined {
  const byId = new Map(employees.map((e) => [e.id, e]));
  const own = input.filter((s) => s.date === date && mayWorkOn(byId.get(s.employeeId)!, date));
  if (own.some((s) => byId.get(s.employeeId)?.workRole === "SERVICE" && s.pauseMinutes > 0 && !hasValidBreak(s))) return;
  const gaps: { startMinutes: number; endMinutes: number }[] = [];
  for (const block of day.blocks) for (let t = block.startMinutes; t < block.endMinutes; t++) {
    if (own.some((s) => isWorkingInRoleAt(s, byId.get(s.employeeId)!, "SERVICE", t))) continue;
    const previous = gaps[gaps.length - 1];
    if (previous?.endMinutes === t) previous.endMinutes++;
    else gaps.push({ startMinutes: t, endMinutes: t + 1 });
  }
  if (!gaps.length || gaps.reduce((sum, g) => sum + g.endMinutes - g.startMinutes, 0) > 60) return;
  const ownerIds = new Set(employees.filter((e) => e.isOwner).map((e) => e.id));
  for (const owner of own.filter((s) => s.generated && ownerIds.has(s.employeeId) && byId.get(s.employeeId)?.workRole === "KITCHEN")) {
    if (!gaps.every((g) => owner.startMinutes <= g.startMinutes && owner.endMinutes >= g.endMinutes)) continue;
    const kitchen = own.filter((s) => byId.get(s.employeeId)?.workRole === "KITCHEN").map((s): Shift => ({ ...s,
      ...(s.generated ? { pauseStartMinutes: undefined } : {}),
      ...(s.id === owner.id ? { serviceCoverWindows: [...(s.serviceCoverWindows ?? []), ...gaps] } : {}),
    }));
    if (!assignCoveredBreaks(kitchen, day.blocks, ownerIds)) continue;
    const changes = new Map(kitchen.map((s) => [s.id, s]));
    const trial = input.map((s) => changes.get(s.id) ?? s);
    if ((["KITCHEN", "SERVICE"] as const).every((role) => hasContinuousRoleCoverage(employees, trial, date, day.blocks, role))) return trial;
  }
}

/** Replace an isolated one-hour service visit with paid work by the owner.
 * Reallocate the employee's hour into an existing short shift; never change
 * monthly hours or add a workday. Commit only a completely covered result. */
export function replaceOneHourReliefWithOwner(
  employees: Employee[], input: Shift[], dayOf: (date: string) => ResolvedDay,
): Shift[] {
  let result = input;
  const byId = new Map(employees.map((e) => [e.id, e]));
  const ownerIds = new Set(employees.filter((e) => e.isOwner).map((e) => e.id));
  const covered = (shifts: Shift[], date: string, role: WorkRole): boolean => {
    const own = shifts.filter((s) => s.date === date && mayWorkOn(byId.get(s.employeeId)!, date));
    if (own.some((s) => byId.get(s.employeeId)?.workRole === role && s.pauseMinutes > 0 && !hasValidBreak(s))) return false;
    return dayOf(date).blocks.every((block) => {
      const points = new Set([block.startMinutes, ...own.flatMap((s) => [s.startMinutes, s.endMinutes,
        ...(hasValidBreak(s) ? [s.pauseStartMinutes!, s.pauseStartMinutes! + s.pauseMinutes] : []),
        ...(s.serviceCoverWindows ?? []).flatMap((w) => [w.startMinutes, w.endMinutes]),
      ]).filter((t) => t >= block.startMinutes && t < block.endMinutes)]);
      return [...points].every((t) => own.some((s) => isWorkingInRoleAt(s, byId.get(s.employeeId)!, role, t)));
    });
  };

  for (const relief of input.filter((s) => s.generated && s.isBreakCover && s.paidMinutes === 60 && s.pauseMinutes === 0)) {
    const employee = byId.get(relief.employeeId);
    if (!employee || employee.workRole !== "SERVICE" || employee.fixedShift || employee.employmentType === "AZUBI") continue;
    const owners = result.filter((s) => s.date === relief.date && s.generated &&
      byId.get(s.employeeId)?.isOwner && byId.get(s.employeeId)?.workRole === "KITCHEN" &&
      mayWorkOn(byId.get(s.employeeId)!, s.date) &&
      s.startMinutes <= relief.startMinutes && s.endMinutes >= relief.endMinutes &&
      !(s.serviceCoverWindows ?? []).some((w) => w.startMinutes < relief.endMinutes && relief.startMinutes < w.endMinutes));
    let replacement: Shift[] | undefined;
    for (const owner of owners) {
      const kitchen = result.filter((s) => s.date === relief.date && byId.get(s.employeeId)?.workRole === "KITCHEN")
        .map((s): Shift => ({ ...s, ...(s.generated ? { pauseStartMinutes: undefined } : {}),
          ...(s.id === owner.id ? { serviceCoverWindows: [...(s.serviceCoverWindows ?? []),
            { startMinutes: relief.startMinutes, endMinutes: relief.endMinutes }] } : {}),
        }));
      if (!assignCoveredBreaks(kitchen, dayOf(relief.date).blocks, ownerIds)) continue;
      const kitchenById = new Map(kitchen.map((s) => [s.id, s]));
      const base = result.filter((s) => s.id !== relief.id).map((s) => kitchenById.get(s.id) ?? s);
      const receivers = base.filter((s) => s.employeeId === employee.id && s.generated && s.pauseMinutes === 0 &&
        s.paidMinutes >= 180 && s.paidMinutes <= 300 && mayWorkOn(employee, s.date));
      for (const receiver of receivers) {
        for (const [start, end] of [[receiver.startMinutes - 60, receiver.endMinutes], [receiver.startMinutes, receiver.endMinutes + 60]]) {
          const day = dayOf(receiver.date);
          if (day.closed || !day.blocks.some((b) => b.startMinutes <= start && b.endMinutes >= end)) continue;
          const conflict = base.some((s) => {
            if (s.employeeId !== employee.id || s.id === receiver.id) return false;
            const distance = daysBetween(receiver.date, s.date);
            if (distance === 0) return start < s.endMinutes && s.startMinutes < end;
            return distance > 0 ? distance * 1440 + s.startMinutes - end < 660 : -distance * 1440 + start - s.endMinutes < 660;
          });
          if (conflict || base.filter((s) => s.employeeId === employee.id && s.date === receiver.date)
            .reduce((sum, s) => sum + s.paidMinutes, 60) > 540) continue;
          const trial = base.map((s): Shift => s.id === receiver.id ? { ...s, startMinutes: start, endMinutes: end,
            paidMinutes: s.paidMinutes + 60, shiftType: "CUSTOM" } : s);
          if (![relief.date, receiver.date].every((date) => covered(trial, date, "KITCHEN") && covered(trial, date, "SERVICE"))) continue;
          replacement = trial;
          break;
        }
        if (replacement) break;
      }
      if (replacement) break;
    }
    if (replacement) result = replacement;
  }
  return result;
}
