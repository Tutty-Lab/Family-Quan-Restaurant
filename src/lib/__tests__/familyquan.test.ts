// ============================================================================
// Die Besonderheiten von FamilyQuan:
//   - Wochenverträge (weeklyHours) -> Monats-Soll über die offenen Tage (÷7,
//     der Laden hat keinen Ruhetag).
//   - Zwei Bereiche (Küche/Service), die UNABHÄNGIG voneinander zu jeder
//     offenen Minute besetzt sein müssen.
//   - Der Chef (isOwner) steht jeden offenen Tag durchgehend 12:00–22:00 in
//     der Küche und bildet deren Grundbesetzung – auch über sieben Tage die
//     Woche, ohne die Sechs-Tage-Regel zu verletzen.
// ============================================================================

import { describe, expect, it } from "vitest";
import { generateSchedule, minCoverageOver } from "../scheduler";
import { validateSchedule } from "../validation";
import { DEFAULT_WORK_HOURS, resolveDay } from "../workHours";
import { publicHolidays } from "../holidays";
import { datesOfMonth } from "../demand";
import { monthlyTargetMinutes, OPEN_DAYS_PER_WEEK } from "../contract";
import { maxConsecutiveRun } from "../consecutive";
import type { Employee } from "../../types";

const openDaysOf = (year: number, month: number): number => {
  const hol = publicHolidays(year);
  return datesOfMonth(year, month).filter(
    (d) => !resolveDay(DEFAULT_WORK_HOURS, d, hol, {}).closed,
  ).length;
};

const wk = (
  id: string,
  t: Employee["employmentType"],
  h: number,
  x: Partial<Employee> = {},
): Employee => ({ id, name: id, employmentType: t, targetMinutes: 0, weeklyHours: h, ...x });

// Genau die reale Belegschaft: Chef + 4 Service (bồi) + 2 Küche (bếp).
const familyTeam = (): Employee[] => [
  wk("owner", "VOLLZEIT", 63, { workRole: "KITCHEN", isOwner: true }),
  wk("s1", "VOLLZEIT", 40, { workRole: "SERVICE" }),
  wk("k1", "VOLLZEIT", 40, { workRole: "KITCHEN" }),
  wk("s2", "MINIJOB", 10.5, { workRole: "SERVICE" }),
  wk("s3", "MINIJOB", 10, { workRole: "SERVICE" }),
  wk("s4", "MINIJOB", 10, { workRole: "SERVICE" }),
  wk("k2", "MINIJOB", 12, { workRole: "KITCHEN" }),
];

describe("Wochenvertrag -> Monats-Soll (÷7, kein Ruhetag)", () => {
  it("rechnet 40 h/Woche über die offenen Tage um", () => {
    expect(OPEN_DAYS_PER_WEEK).toBe(7);
    // 40 × 28 / 7 = 160 h.
    expect(monthlyTargetMinutes(wk("a", "VOLLZEIT", 40), 28)).toBe(160 * 60);
    // 40 × 30 / 7 = 171,4 -> 171 h (auf ganze Stunden gerundet).
    expect(monthlyTargetMinutes(wk("a", "VOLLZEIT", 40), 30)).toBe(171 * 60);
  });

  it("ohne weeklyHours gilt targetMinutes direkt", () => {
    const emp: Employee = { id: "a", name: "a", employmentType: "TEILZEIT", targetMinutes: 100 * 60 };
    expect(monthlyTargetMinutes(emp, 30)).toBe(100 * 60);
  });

  for (const month of [9, 10, 11]) {
    it(`tháng ${month}: nhân viên (không phải chủ) đủ đúng định mức quy đổi từ tuần`, () => {
      const openDays = openDaysOf(2026, month);
      const shifts = generateSchedule({
        year: 2026,
        month,
        workHours: DEFAULT_WORK_HOURS,
        employees: familyTeam(),
      });
      for (const e of familyTeam()) {
        if (e.isOwner) continue; // der Chef ist feste Präsenz, kein Ziel-Soll
        const got = shifts.filter((s) => s.employeeId === e.id).reduce((a, s) => a + s.paidMinutes, 0);
        expect(got).toBe(monthlyTargetMinutes(e, openDays));
      }
      const v = validateSchedule(familyTeam(), shifts, 2026, openDays);
      expect(v.errors.filter((x) => x.severity !== "warning")).toEqual([]);
    });
  }
});

describe("Chef: Grundbesetzung der Küche, 7 Tage die Woche", () => {
  for (const month of [9, 10, 12]) {
    const openDays = openDaysOf(2026, month);
    const shifts = generateSchedule({
      year: 2026,
      month,
      workHours: DEFAULT_WORK_HOURS,
      employees: familyTeam(),
    });
    const ownerShifts = shifts.filter((s) => s.employeeId === "owner");

    it(`tháng ${month}: chủ có mặt mọi ngày mở cửa, đúng khung 12:00–22:00`, () => {
      expect(ownerShifts.length).toBe(openDays);
      for (const s of ownerShifts) {
        expect(s.startMinutes).toBe(12 * 60);
        expect(s.endMinutes).toBe(22 * 60);
      }
    });

    it(`tháng ${month}: chủ làm 7 ngày liên tiếp nhưng KHÔNG bị coi là lỗi`, () => {
      const dates = ownerShifts.map((s) => s.date);
      expect(maxConsecutiveRun(dates)).toBeGreaterThan(6);
      const v = validateSchedule(familyTeam(), shifts, 2026, openDays);
      expect(v.valid).toBe(true);
    });
  }
});

describe("Zwei Bereiche sind immer besetzt", () => {
  for (const month of [9, 10]) {
    it(`tháng ${month}: mỗi khu (bếp/bồi) luôn có ít nhất 1 người 12:00–22:00`, () => {
      const shifts = generateSchedule({
        year: 2026,
        month,
        workHours: DEFAULT_WORK_HOURS,
        employees: familyTeam(),
      });
      const roleOf = new Map(familyTeam().map((e) => [e.id, e.workRole] as const));
      const hol = publicHolidays(2026);
      for (const d of datesOfMonth(2026, month)) {
        if (resolveDay(DEFAULT_WORK_HOURS, d, hol, {}).closed) continue;
        for (const zone of ["KITCHEN", "SERVICE"] as const) {
          const zs = shifts.filter((s) => s.date === d && roleOf.get(s.employeeId) === zone);
          expect(minCoverageOver(zs, 12 * 60, 22 * 60)).toBeGreaterThanOrEqual(1);
        }
      }
    });
  }
});
