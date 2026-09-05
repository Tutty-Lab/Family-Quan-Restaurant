// ============================================================================
// Beispieldaten: die Belegschaft von FamilyQuan Bistro (6 Kräfte + Chef), alle
// mit WOCHENstunden und einem festen Bereich (Küche/Service).
// ============================================================================

import type { Employee, Schedule } from "../types";
import { DEFAULT_WORK_HOURS } from "./workHours";
import { COMPANY_ADDRESS, COMPANY_NAME } from "./company";

export function makeEmployee(
  id: string,
  name: string,
  employmentType: Employee["employmentType"],
  targetHours: number,
): Employee {
  return { id, name, employmentType, targetMinutes: targetHours * 60 };
}

/** Mitarbeiter mit WOCHENvertrag (FamilyQuan rechnet in Wochenstunden). */
export function makeWeekly(
  id: string,
  name: string,
  employmentType: Employee["employmentType"],
  weeklyHours: number,
  /** Fester Bereich: Küche (bếp) oder Service (bồi). */
  workRole?: Employee["workRole"],
): Employee {
  return { id, name, employmentType, targetMinutes: 0, weeklyHours, workRole };
}

/**
 * Belegschaft laut Angabe des Betriebs (FamilyQuan Bistro): 6 Kräfte mit
 * WOCHENstunden, dazu der Chef. Vollzeit = 40 h/Woche.
 *
 * Zwei Bereiche: Küche (bếp / KITCHEN) und Service (bồi / SERVICE); beide
 * müssen immer besetzt sein und werden getrennt geplant.
 *
 * ANNAHMEN, die der Betrieb bestätigen sollte:
 *   - Anstellungsart aus den Wochenstunden abgeleitet: 40 h = Vollzeit,
 *     10–12 h = Minijob.
 *   - Der Chef ("Chủ") steht die ganze Woche in der Küche (7 Tage, 12:00–22:00)
 *     und ist als isOwner markiert; seine 63 Wochenstunden = 7 × 9 h bezahlte
 *     Zeit bei durchgehendem Dienst.
 */
export const SAMPLE_EMPLOYEES: Employee[] = [
  { ...makeWeekly("ma-0", "Chủ (Bếp)", "VOLLZEIT", 63, "KITCHEN"), isOwner: true },
  makeWeekly("ma-1", "Nguyễn Thi Hương", "VOLLZEIT", 40, "SERVICE"),
  makeWeekly("ma-2", "Nguyễn Dinh Kỳ", "VOLLZEIT", 40, "KITCHEN"),
  makeWeekly("ma-3", "Đậu Thi Huấn", "MINIJOB", 10.5, "SERVICE"),
  makeWeekly("ma-4", "Su Phuong Anh", "MINIJOB", 10, "SERVICE"),
  makeWeekly("ma-5", "Nguyen Thi Phuong Liên", "MINIJOB", 10, "SERVICE"),
  makeWeekly("ma-6", "Nguyen Thi Phương Lan", "MINIJOB", 12, "KITCHEN"),
];

export function createSampleSchedule(): Schedule {
  return {
    companyName: COMPANY_NAME,
    address: COMPANY_ADDRESS,
    year: 2026,
    month: 8, // August
    workHours: structuredClone(DEFAULT_WORK_HOURS),
    dateOverrides: [],
    employees: SAMPLE_EMPLOYEES.map((e) => ({ ...e })),
    shifts: [],
  };
}

/**
 * Startbelegschaft, die die App beim allerersten Öffnen zeigt (September 2026),
 * genau die sechs Kräfte aus der Angabe des Betriebs plus der Chef, mit ihren
 * Wochenstunden und ihrem Bereich (Küche/Service).
 */
export function createInitialSchedule(): Schedule {
  const year = 2026;
  const month = 9;
  const employees: Employee[] = [
    { ...makeWeekly("ma-0", "Chủ (Bếp)", "VOLLZEIT", 63, "KITCHEN"), isOwner: true },
    makeWeekly("ma-1", "Nguyễn Thi Hương", "VOLLZEIT", 40, "SERVICE"),
    makeWeekly("ma-2", "Nguyễn Dinh Kỳ", "VOLLZEIT", 40, "KITCHEN"),
    makeWeekly("ma-3", "Đậu Thi Huấn", "MINIJOB", 10.5, "SERVICE"),
    makeWeekly("ma-4", "Su Phuong Anh", "MINIJOB", 10, "SERVICE"),
    makeWeekly("ma-5", "Nguyen Thi Phuong Liên", "MINIJOB", 10, "SERVICE"),
    makeWeekly("ma-6", "Nguyen Thi Phương Lan", "MINIJOB", 12, "KITCHEN"),
  ];
  return {
    companyName: COMPANY_NAME,
    address: COMPANY_ADDRESS,
    year,
    month,
    workHours: structuredClone(DEFAULT_WORK_HOURS),
    dateOverrides: [],
    employees,
    shifts: [],
  };
}
