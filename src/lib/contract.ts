// ============================================================================
// Wochenvertrag -> Monatssoll.
//
// FamilyQuan gibt Verträge in WOCHENstunden an (40 h/Woche = Vollzeit). Der
// Scheduler plant aber einen Monat und rechnet in Monats-Sollminuten. Diese
// Umrechnung steht hier an EINER Stelle, damit Scheduler, Prüfung und Anzeige
// dieselbe Zahl verwenden.
//
// Umgerechnet wird über die tatsächlich OFFENEN Tage des Monats, nicht über
// einen festen Faktor: der Laden hat SIEBEN offene Tage die Woche (kein
// Ruhetag). Ein Monat mit mehr offenen Tagen trägt entsprechend mehr Stunden.
// Feiertage sind offen und zählen mit.
// ============================================================================

import type { Employee } from "../types";

/** Offene Tage je Woche: alle sieben – FamilyQuan hat keinen Ruhetag. */
export const OPEN_DAYS_PER_WEEK = 7;

/**
 * Monats-Soll dieser Person in Minuten.
 *
 * Ist weeklyHours gesetzt, ist das die Quelle:
 *   Monatsstunden = Wochenstunden × offene Tage des Monats ÷ 6
 * auf ganze Stunden gerundet (der Plan besteht aus Diensten in ganzen Stunden).
 * Ohne weeklyHours gilt das direkt eingetragene targetMinutes.
 */
export function monthlyTargetMinutes(emp: Employee, openDaysInMonth: number): number {
  if (emp.weeklyHours != null && emp.weeklyHours > 0) {
    const stunden = Math.round((emp.weeklyHours * openDaysInMonth) / OPEN_DAYS_PER_WEEK);
    return stunden * 60;
  }
  return emp.targetMinutes;
}
