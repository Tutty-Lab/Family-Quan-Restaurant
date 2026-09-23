// ============================================================================
// Validierung des Dienstplans gegen alle geforderten Regeln.
// ============================================================================

import {
  AZUBI_MAX_MONTHLY_HOURS,
  OWNER_MAX_SHIFT_HOURS,
  type Employee,
  type Shift,
} from "../types";
import { monthlyTargetMinutes } from "./contract";
import { calculatePause } from "./time";
import { maxConsecutiveRun } from "./consecutive";
import { hasValidBreak } from "./serviceCoverage";
import { mayWorkOn } from "./availability";
import { weekStartOf } from "./weeks";

export type ValidationError = {
  employeeId?: string;
  date?: string;
  message: string;
  /**
   * "error" = der Plan ist unzulässig und muss korrigiert werden.
   * "warning" = der Plan ist benutzbar, etwas passt nur nicht ideal.
   *
   * Ein zu hohes Monats-Soll ist eine WARNUNG: der Plan bleibt gültig, es
   * fehlen nur Stunden, die der Monat gar nicht hergibt. Das als Fehler zu
   * führen hieße, dem Betrieb einen brauchbaren Plan vorzuenthalten, weil eine
   * Zahl in der Mitarbeiterliste zu groß ist.
   */
  severity?: "error" | "warning";
};

export type EmployeeSummary = {
  employee: Employee;
  assignedMinutes: number;
  targetMinutes: number;
  diffMinutes: number; // assigned - target
  maxConsecutiveDays: number;
  shiftCount: number;
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
  summaries: EmployeeSummary[];
};

/**
 * Höchste bezahlte Zeit an einem Tag. Der Chef darf 10 Stunden, alle anderen
 * 9 – siehe OWNER_MAX_SHIFT_HOURS. Beide Werte liegen unter der Grenze des
 * Arbeitszeitgesetzes (§ 3 ArbZG: bis zu 10 Stunden, wenn im Halbjahr auf 8
 * ausgeglichen).
 */
const MAX_PAID_MINUTES = 9 * 60;
const MAX_PAID_MINUTES_OWNER = OWNER_MAX_SHIFT_HOURS * 60;
const MAX_CONSECUTIVE_DAYS = 6;

export function validateSchedule(
  employees: Employee[],
  shifts: Shift[],
  /** Jahr des geplanten Monats. Bei FamilyQuan ohne Urlaub ungenutzt, aber für
   *  die einheitliche Signatur über alle Filialen erhalten. */
  _year: number = new Date().getFullYear(),
  /**
   * Offene Tage des geplanten Monats – nötig, um Wochenverträge (weeklyHours)
   * in ein Monats-Soll umzurechnen. Fehlt der Wert, gilt targetMinutes direkt.
   */
  openDays?: number,
): ValidationResult {
  const errors: ValidationError[] = [];
  const sollOf = (e: Employee): number =>
    openDays != null ? monthlyTargetMinutes(e, openDays) : e.targetMinutes;
  const employeeById = new Map(employees.map((e) => [e.id, e] as const));

  // Azubi: höchstens 43 Stunden im Monat. Eine WARNUNG, kein Riegel – ob mehr
  // erlaubt ist, steht im Ausbildungsvertrag und nicht in diesem Programm.
  for (const emp of employees) {
    if (emp.employmentType !== "AZUBI") continue;
    const stunden = emp.targetMinutes / 60;
    if (stunden > AZUBI_MAX_MONTHLY_HOURS) {
      errors.push({
        employeeId: emp.id,
        severity: "warning",
        message:
          `${emp.name}: học nghề ${stunden}h/tháng, vượt mức ${AZUBI_MAX_MONTHLY_HOURS}h.`,
      });
    }
  }

  // Für Kylan gibt es bewusst KEINE Zahlengrenzen bei der Belegschaft –
  // weder für die Anzahl der Beschäftigten noch eine eigene Stundendecke für
  // Minijobs. Siehe Kommentar in types.ts.
  const shiftsByEmployee = new Map<string, Shift[]>();
  for (const emp of employees) shiftsByEmployee.set(emp.id, []);
  for (const shift of shifts) {
    if (!shiftsByEmployee.has(shift.employeeId)) {
      shiftsByEmployee.set(shift.employeeId, []);
    }
    shiftsByEmployee.get(shift.employeeId)!.push(shift);
  }

  // Regeln je einzelner Schicht.
  for (const shift of shifts) {
    const presence = shift.endMinutes - shift.startMinutes;
    const expectedPaid = presence - shift.pauseMinutes;
    const expectedPause = calculatePause(shift.paidMinutes);
    const employee = employeeById.get(shift.employeeId);
    if (employee?.isOwner && employee.workRole === "KITCHEN" && hasValidBreak(shift) && shifts.some((other) =>
      other.date === shift.date && other.employeeId !== shift.employeeId &&
      employeeById.get(other.employeeId)?.workRole === "KITCHEN" && hasValidBreak(other) &&
      shift.pauseStartMinutes! < other.pauseStartMinutes! + other.pauseMinutes &&
      other.pauseStartMinutes! < shift.pauseStartMinutes! + shift.pauseMinutes)) {
      errors.push({ employeeId: shift.employeeId, date: shift.date,
        message: `${shift.date}: giờ nghỉ của chủ trùng giờ nghỉ nhân viên bếp.`,
      });
    }
    const covers = shift.serviceCoverWindows ?? [];
    if (covers.length > 0) {
      const invalid = !employee?.isOwner || employee.workRole !== "KITCHEN" ||
        (shift.pauseMinutes > 0 && !hasValidBreak(shift)) ||
        covers.some((w, i) => !Number.isInteger(w.startMinutes) || !Number.isInteger(w.endMinutes) ||
          w.startMinutes < shift.startMinutes || w.endMinutes > shift.endMinutes || w.endMinutes <= w.startMinutes ||
          (hasValidBreak(shift) && w.startMinutes < shift.pauseStartMinutes! + shift.pauseMinutes && shift.pauseStartMinutes! < w.endMinutes) ||
          covers.slice(i + 1).some((other) => w.startMinutes < other.endMinutes && other.startMinutes < w.endMinutes));
      if (invalid) errors.push({ employeeId: shift.employeeId, date: shift.date,
        message: `${shift.date}: giờ chủ phụ bồi không hợp lệ, nằm ngoài ca hoặc trùng giờ nghỉ.`,
      });
    }
    if (employee && !mayWorkOn(employee, shift.date)) {
      errors.push({ employeeId: employee.id, date: shift.date,
        message: `${employee.name}: đã xếp ca vào ngày không thể làm ${shift.date}.`,
      });
    }

    if (shift.endMinutes <= shift.startMinutes) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        message: `Giờ ra không sau giờ vào (${shift.date}).`,
      });
    }
    if (shift.paidMinutes !== expectedPaid) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        message: `Giờ công không khớp giờ vào/ra/nghỉ ngày ${shift.date}.`,
      });
    }
    if (shift.pauseMinutes !== expectedPause) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        message: `Sai giờ nghỉ ngày ${shift.date}: ${shift.pauseMinutes} thay vì ${expectedPause} phút.`,
      });
    }
    if (shift.pauseStartMinutes != null && !hasValidBreak(shift)) {
      errors.push({ employeeId: shift.employeeId, date: shift.date,
        message: `Giờ nghỉ không hợp lệ ngày ${shift.date}: phải nằm trong ca, không làm liên tục quá 6 giờ.`,
      });
    }
  }

  const summaries: EmployeeSummary[] = [];

  for (const emp of employees) {
    const empShifts = shiftsByEmployee.get(emp.id) ?? [];

    // Höchstens ein Dienst pro Tag.
    // Zwei Dienste an einem Tag sind erlaubt, solange sie sich nicht
    // überschneiden – mittags und abends bei einem Laden, der zwischendurch
    // schließt. Verboten bleibt nur, was sich überlappt.
    const seenDates = new Set<string>();
    const overlapDates = new Set<string>();
    const paidByDate = new Map<string, number>();
    for (const shift of empShifts) {
      const ueberschneidet = empShifts.some(
        (a) =>
          a !== shift &&
          a.date === shift.date &&
          a.startMinutes < shift.endMinutes &&
          shift.startMinutes < a.endMinutes,
      );
      if (ueberschneidet && !overlapDates.has(shift.date)) {
        overlapDates.add(shift.date);
        errors.push({
          employeeId: emp.id,
          date: shift.date,
          message: `Có nhiều hơn một ca ngày ${shift.date}.`,
        });
      }
      seenDates.add(shift.date);
      paidByDate.set(shift.date, (paidByDate.get(shift.date) ?? 0) + shift.paidMinutes);
    }

    // The daily limit applies to all pieces together, including split shifts.
    const paidLimit = emp.isOwner ? MAX_PAID_MINUTES_OWNER : MAX_PAID_MINUTES;
    for (const [date, paid] of paidByDate) {
      if (paid > paidLimit) errors.push({
        employeeId: emp.id,
        date,
        message: `Quá ${paidLimit / 60} giờ công ngày ${date}.`,
      });
    }

    if (emp.maxDaysPerWeek != null && !emp.isOwner) {
      const counts = new Map<string, number>();
      for (const date of seenDates) {
        const week = weekStartOf(date);
        counts.set(week, (counts.get(week) ?? 0) + 1);
      }
      for (const [week, count] of counts) {
        if (count > emp.maxDaysPerWeek) errors.push({ employeeId: emp.id, date: week,
          message: `${emp.name}: tuần ${week} đã xếp ${count} ngày, vượt giới hạn ${emp.maxDaysPerWeek} ngày/tuần.`,
        });
      }
    }

    const assignedMinutes = empShifts.reduce((sum, s) => sum + s.paidMinutes, 0);
    const maxRun = maxConsecutiveRun(empShifts.map((s) => s.date));
    const soll = sollOf(emp);

    // Der Chef steht nach eigener Regel jeden offenen Tag in der Küche; sein
    // „Soll" ist genau diese feste Präsenz, keine verteilte Zielzahl. Deshalb
    // wird er weder auf exaktes Soll noch auf die Sechs-Tage-Regel geprüft –
    // beides würde ihn fälschlich als Fehler ausweisen.
    if (assignedMinutes !== soll && !emp.isOwner) {
      // Zu WENIG verteilt heißt: der Monat gibt nicht mehr her (oder eine feste
      // Schicht trifft das Soll nicht ganz genau) – Warnung. Zu VIEL wäre ein
      // echter Fehler im Plan.
      const zuViel = assignedMinutes < soll;
      errors.push({
        employeeId: emp.id,
        severity: zuViel ? "warning" : "error",
        message: zuViel
          ? `${emp.name}: mới xếp được ${assignedMinutes / 60}h / ${soll / 60}h — tháng này không đủ ngày cho định mức đó.`
          : `${emp.name}: xếp quá giờ định mức: ${assignedMinutes / 60} h thay vì ${soll / 60} h.`,
      });
    }
    if (maxRun > MAX_CONSECUTIVE_DAYS && !emp.isOwner) {
      errors.push({
        employeeId: emp.id,
        message: `${emp.name}: làm quá 6 ngày liên tiếp (${maxRun}).`,
      });
    }

    summaries.push({
      employee: emp,
      assignedMinutes,
      targetMinutes: soll,
      diffMinutes: assignedMinutes - soll,
      maxConsecutiveDays: maxRun,
      shiftCount: empShifts.length,
    });
  }

  // Warnungen machen den Plan nicht ungültig – sonst blockiert eine zu große
  // Zahl in der Mitarbeiterliste das Drucken eines sonst brauchbaren Plans.
  const echteFehler = errors.filter((e) => e.severity !== "warning");
  return { valid: echteFehler.length === 0, errors, summaries };
}
