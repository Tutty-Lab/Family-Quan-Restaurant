import type { Employee, Shift } from "../types";
import { mayWorkOn } from "./availability";
import { daysBetween } from "./consecutive";
import { weekStartOf } from "./weeks";
import type { ResolvedDay } from "./workHours";

type Part = { hours: number; start: number; end: number; pauseStart?: number; cover?: boolean };
type Pair = [Part, Part];

function pairsFor(start: number, end: number, totalHours: number): Pair[] {
  const hours = (end - start) / 60;
  const pairs: Pair[] = [];
  // A full-day worker takes an explicit hour off. A short relief shift covers it.
  if (hours >= 8 && hours <= 10) {
    const relief = totalHours - (hours - 1);
    if (relief >= 1 && relief <= 6 && relief < hours) {
      const pauseStart = Math.min(start + 4 * 60, end - relief * 60);
      pairs.push([
        { hours: hours - 1, start, end, pauseStart },
        { hours: relief, start: pauseStart, end: pauseStart + relief * 60, cover: true },
      ]);
    }
  }
  // Short shifts hand over directly; neither employee needs an internal break.
  for (let early = 3; early <= 6; early++) {
    const late = totalHours - early;
    if (late >= 3 && late <= 6 && early <= hours && late <= hours) {
      pairs.push([
        { hours: early, start, end: start + early * 60 },
        { hours: late, start: end - late * 60, end },
      ]);
    }
  }
  return pairs;
}

/** Exact service-hour allocation, including break relief, for continuous opening days. */
export function tryGenerateServiceSchedule(
  employees: Employee[],
  dates: string[],
  dayOf: (date: string) => ResolvedDay,
): Shift[] | undefined {
  const team = employees.filter((e) => e.targetMinutes > 0);
  const open = dates.filter((date) => !dayOf(date).closed);
  if (team.length < 2 || team.length > 8 || open.length === 0 ||
      team.some((e) => e.fixedShift || e.isOwner || e.employmentType === "AZUBI" || e.targetMinutes % 60 !== 0)) return;
  if (open.some((date) => {
    const day = dayOf(date);
    const hours = (day.window.endMinutes - day.window.startMinutes) / 60;
    return day.blocks.length !== 1 || !Number.isInteger(hours) || hours < 6 || hours > 10;
  })) return;

  const targets = team.map((e) => e.targetMinutes / 60);
  const dailyHours = open.map((date) => {
    const window = dayOf(date).window;
    return (window.endMinutes - window.startMinutes) / 60;
  });
  const surplus = targets.reduce((a, b) => a + b, 0) - dailyHours.reduce((a, b) => a + b, 0);
  if (surplus < 0) return;
  if (surplus > dailyHours.reduce((sum, hours) => sum + 12 - hours, 0)) return;

  // Search decides where overlap is feasible; busy days are only a preference.
  const templates = open.map((date, i) => {
    const window = dayOf(date).window;
    return Array.from({ length: Math.min(surplus, 12 - dailyHours[i]) + 1 }, (_, extra) =>
      pairsFor(window.startMinutes, window.endMinutes, dailyHours[i] + extra)).flat();
  });
  const remainingBase = open.map((_, i) => dailyHours.slice(i).reduce((sum, hours) => sum + hours, 0));
  const eligible = open.map((date) => team.map((e) => mayWorkOn(e, date)));
  const weeks = open.map(weekStartOf);
  const futureCapacity = open.map((_, i) => team.map((_, e) =>
    open.slice(i).reduce((sum, _date, offset) => sum + (eligible[i + offset][e] ? 9 : 0), 0),
  ));
  let visits = 0;
  const failed = new Set<string>();
  const result: { people: [number, number]; parts: Pair }[] = [];

  function search(day: number, left: number[], runs: number[], weekDays: number[]): boolean {
    if (day === open.length) return left.every((h) => h === 0);
    if (++visits > 60_000) return false;
    if (left.some((h, e) => h < 0 || h > futureCapacity[day][e])) return false;
    const remainingSurplus = left.reduce((sum, hours) => sum + hours, 0) - remainingBase[day];
    if (remainingSurplus < 0 || remainingSurplus > (open.length - day) * 12 - remainingBase[day]) return false;
    const key = `${day}|${left}|${runs}|${weekDays}`;
    if (failed.has(key)) return false;
    const newWeek = day === 0 || weeks[day] !== weeks[day - 1];
    const consecutive = day > 0 && daysBetween(open[day - 1], open[day]) === 1;
    const allowed = team.map((e, i) => eligible[day][i] && (!consecutive || runs[i] < 6) &&
      (newWeek || weekDays[i] < Math.min(6, e.maxDaysPerWeek ?? 6)) && (e.maxDaysPerWeek ?? 6) > 0);
    const choices: { people: [number, number]; parts: Pair; score: number }[] = [];
    for (let a = 0; a < team.length; a++) for (let b = 0; b < team.length; b++) {
      if (a === b || !allowed[a] || !allowed[b]) continue;
      for (const parts of templates[day]) {
        const extra = parts[0].hours + parts[1].hours - dailyHours[day];
        if (extra > remainingSurplus) continue;
        if (parts[0].hours > left[a] || parts[1].hours > left[b]) continue;
        if ((team[a].employmentType === "VOLLZEIT" && parts[0].hours < 4) ||
            (team[b].employmentType === "VOLLZEIT" && parts[1].hours < 4)) continue;
        const remainingDays = open.length - day;
        const score = left.reduce((sum, hours, e) => {
          const used = e === a ? parts[0].hours : e === b ? parts[1].hours : 0;
          return sum + (hours - used - targets[e] * (remainingDays - 1) / open.length) ** 2;
        }, 0) + (parts[0].pauseStart == null ? 0 : 2) -
          ([0, 6].includes(new Date(`${open[day]}T12:00:00`).getDay()) ? extra : 0);
        choices.push({ people: [a, b], parts, score });
      }
    }
    choices.sort((a, b) => a.score - b.score);
    for (const choice of choices) {
      const next = [...left];
      choice.people.forEach((e, p) => { next[e] -= choice.parts[p].hours; });
      const nextRuns = runs.map((run, e) => choice.people.includes(e) ? (consecutive ? run + 1 : 1) : 0);
      const nextWeek = weekDays.map((count, e) => (newWeek ? 0 : count) + Number(choice.people.includes(e)));
      result[day] = choice;
      if (search(day + 1, next, nextRuns, nextWeek)) return true;
    }
    failed.add(key);
    return false;
  }

  if (!search(0, targets, team.map(() => 0), team.map(() => 0))) return;
  return result.flatMap(({ people, parts }, day) => parts.map((part, p): Shift => ({
    id: `service-${open[day]}-${team[people[p]].id}`,
    employeeId: team[people[p]].id,
    date: open[day],
    startMinutes: part.start,
    endMinutes: part.end,
    paidMinutes: part.hours * 60,
    pauseMinutes: part.pauseStart == null ? 0 : 60,
    ...(part.pauseStart == null ? {} : { pauseStartMinutes: part.pauseStart }),
    ...(part.cover ? { isBreakCover: true } : {}),
    shiftType: part.start === dayOf(open[day]).window.startMinutes ? "EARLY" : "LATE",
    generated: true,
  })));
}
