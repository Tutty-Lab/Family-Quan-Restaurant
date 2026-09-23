import { EVENING_RUSH_START, EVENING_RUSH_END } from "./demand";
import type { Employee, Shift } from "../types";
import type { ResolvedDay } from "./workHours";
import { mayWorkOn } from "./availability";
import { maxConsecutiveRun, daysBetween } from "./consecutive";
import { weekStartOf } from "./weeks";
import { hasContinuousRoleCoverage } from "./serviceCoverage";
import { coverShortServiceGapWithOwner } from "./ownerRelief";
import type { ValidationError } from "./validation";

export function partTimeWeeks(employee: Employee, dates: string[], dayOf: (date: string) => ResolvedDay) {
  const weeks = new Map<string, string[]>();
  for (const date of dates) {
    if (dayOf(date).closed) continue;
    const key = weekStartOf(date);
    weeks.set(key, [...(weeks.get(key) ?? []), date]);
  }
  return [...weeks].map(([week, open]) => {
    const available = open.filter((d) => mayWorkOn(employee, d));
    return { week, dates: available, target: Math.min(open.length >= 4 ? 2 : 1, available.length, employee.maxDaysPerWeek ?? 6) };
  }).filter((w) => w.target > 0);
}

export function isPartTime(employee: Employee): boolean {
  return !employee.isOwner && ["TEILZEIT", "MINIJOB"].includes(employee.employmentType);
}

export function weeklyDistributionWarnings(employees: Employee[], shifts: Shift[], dates: string[], dayOf: (date: string) => ResolvedDay): ValidationError[] {
  return employees.filter((e) => isPartTime(e) && (e.targetMinutes > 0 || (e.weeklyHours ?? 0) > 0)).flatMap((e) =>
    partTimeWeeks(e, dates, dayOf).filter((w) => !shifts.some((s) => s.employeeId === e.id && weekStartOf(s.date) === w.week))
      .map((w) => ({ employeeId: e.id, date: w.week, severity: "warning" as const,
        message: `${e.name}: tuần ${w.week} chưa có ca nào dù có ngày được phép làm. Chưa phân bổ được ca với cài đặt hiện tại.`,
      })),
  );
}

/** Redistribute existing paid hours to weeks with few visits. First fill empty
 * weeks, then aim for two visits in full weeks (one in short edge weeks).
 * Split short duties down to two hours only where coverage allows it. */
export function distributePartTimeWeeks(employees: Employee[], input: Shift[], dates: string[], dayOf: (date: string) => ResolvedDay): Shift[] {
  let result = input;
  let serial = 0;
  const partTimeIds = new Set(employees.filter(isPartTime).map((e) => e.id));
  // The restaurant does not use two/three-hour closing-only visits.
  const unsuitableClosingVisit = (start: number, end: number) =>
    end === 22 * 60 && start >= 19 * 60;

  const covered = (shifts: Shift[], date: string) => (["KITCHEN", "SERVICE"] as const)
    .every((role) => hasContinuousRoleCoverage(employees, shifts, date, dayOf(date).blocks, role));
  for (const employee of employees.filter((e) => isPartTime(e) && !e.fixedShift && e.targetMinutes > 0 && e.workRole)) {
    const weeks = partTimeWeeks(employee, dates, dayOf);
    const own = () => result.filter((s) => s.employeeId === employee.id);
    const count = (week: string) => new Set(own().filter((s) => weekStartOf(s.date) === week).map((s) => s.date)).size;
    for (const minimum of [1, 2]) for (const week of weeks) {
      const goal = Math.min(minimum, week.target);
      while (count(week.week) < goal) {
        let replacement: Shift[] | undefined;
        const donors = own().filter((s) => s.generated && s.pauseMinutes === 0 && s.paidMinutes >= 120 &&
          !s.serviceCoverWindows?.length && weekStartOf(s.date) !== week.week)
          .sort((a, b) => count(weekStartOf(b.date)) - count(weekStartOf(a.date)) || b.paidMinutes - a.paidMinutes || a.id.localeCompare(b.id));
        const place = (base: Shift[], amount: number): Shift[] | undefined => {
          const load = (date: string) => new Set(base.filter((s) => s.date === date && partTimeIds.has(s.employeeId)).map((s) => s.employeeId)).size;
          const paid = (date: string) => base.filter((s) => s.date === date).reduce((sum, s) => sum + s.paidMinutes, 0);
          const candidateDates = [...week.dates].sort((a, b) => load(a) - load(b) || paid(a) - paid(b) || a.localeCompare(b));
          for (const date of candidateDates) {
            if (base.some((s) => s.employeeId === employee.id && s.date === date)) continue;
            const worked = base.filter((s) => s.employeeId === employee.id);
            if (new Set(worked.filter((s) => weekStartOf(s.date) === week.week).map((s) => s.date)).size >= Math.min(6, employee.maxDaysPerWeek ?? 6)) continue;
            if (maxConsecutiveRun([...worked.map((s) => s.date), date]) > 6) continue;
            for (const block of dayOf(date).blocks) {
              const starts: number[] = [];
              for (let start = block.startMinutes; start + amount <= block.endMinutes; start += 30) starts.push(start);
              // Prefer dinner support ending at 20:00: 18–20 for two hours,
              // 17–20 for three hours, within the configured opening block.
              const overlap = (start: number) => Math.max(0, Math.min(start + amount, EVENING_RUSH_END) - Math.max(start, EVENING_RUSH_START));
              starts.sort((a, b) => overlap(b) - overlap(a) || Math.abs(a + amount - EVENING_RUSH_END) - Math.abs(b + amount - EVENING_RUSH_END) || a - b);
              for (const start of starts) {
                const end = start + amount;
                if (unsuitableClosingVisit(start, end)) continue;
                if (worked.some((s) => {
                  const distance = daysBetween(date, s.date);
                  return distance > 0 ? distance * 1440 + s.startMinutes - end < 660 : -distance * 1440 + start - s.endMinutes < 660;
                })) continue;
                const trial: Shift[] = [...base, { id: `weekly-${employee.id}-${date}-${serial}`, employeeId: employee.id,
                  date, startMinutes: start, endMinutes: end, paidMinutes: amount, pauseMinutes: 0,
                  generated: true, shiftType: start === block.startMinutes ? "EARLY" : end === block.endMinutes || end >= EVENING_RUSH_START ? "LATE" : "CUSTOM" }];
                if (!covered(trial, date)) continue;
                return trial;
              }
            }
          }
          return undefined;
        };
        const trim = (base: Shift[], donor: Shift, amount: number, trimStart: boolean): Shift[] | undefined => {
          const remaining = donor.paidMinutes - amount;
          let trial = base.filter((s) => s.id !== donor.id);
          if (remaining && unsuitableClosingVisit(donor.startMinutes + (trimStart ? amount : 0), donor.endMinutes - (trimStart ? 0 : amount))) return undefined;
          if (remaining) trial.push({ ...donor, paidMinutes: remaining,
            startMinutes: donor.startMinutes + (trimStart ? amount : 0), endMinutes: donor.endMinutes - (trimStart ? 0 : amount), shiftType: "CUSTOM" });
          if (covered(trial, donor.date)) return trial;
          return employee.workRole === "SERVICE" ? coverShortServiceGapWithOwner(employees, trial, donor.date, dayOf(donor.date)) : undefined;
        };
        for (const donor of donors) {
          const donorWeek = weeks.find((w) => w.week === weekStartOf(donor.date));
          // Leave an existing visit, or move the whole shift only out of a week
          // with more visits than its goal. No month-end concentration.
          const amounts = [120, 180, 240, 300, 360].filter((n) => n <= donor.paidMinutes &&
            (donor.paidMinutes - n >= 120 || (n === donor.paidMinutes && count(weekStartOf(donor.date)) > (donorWeek?.target ?? 1))));
          for (const amount of amounts) {
            for (const trimStart of [false, true]) {
              const base = trim(result, donor, amount, trimStart);
              if (!base) continue;
              replacement = place(base, amount);
              if (replacement) break;
            }
            if (replacement) break;
          }
          if (replacement) break;
        }
        // Two one-hour reductions can fund a useful two-hour visit without
        // creating another isolated one-hour shift or removing existing visits.
        if (!replacement) {
          const splitDonors = donors.filter((s) => s.paidMinutes >= 180);
          pairs: for (let i = 0; i < splitDonors.length; i++) for (let j = i + 1; j < splitDonors.length; j++) {
            for (const firstStart of [false, true]) for (const secondStart of [false, true]) {
              const first = trim(result, splitDonors[i], 60, firstStart);
              if (!first) continue;
              const second = trim(first, splitDonors[j], 60, secondStart);
              if (!second) continue;
              replacement = place(second, 120);
              if (replacement) break pairs;
            }
          }
        }
        if (!replacement) break;
        result = replacement;
        serial++;
      }
    }
  }
  return result;
}
