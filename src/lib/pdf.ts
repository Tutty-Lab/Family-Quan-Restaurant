// Vector timesheets: direct jsPDF text and table lines, no DOM/image/font loading.
// Based on Viet Cuisine's manual table renderer; preserves Family Quan breaks
// and owner service duties and reserves a fixed band for signatures.

import { jsPDF } from "jspdf";
import type { Employee, Schedule, Shift } from "../types";
import {
  datesOfMonth,
  parseIsoDate,
  WEEKDAY_LABELS_DE,
  weekdayKeyOf,
} from "./demand";
import { minutesToDecimalHours, minutesToTime } from "./time";
import { MONTH_NAMES_DE } from "./dateFormat";
import { employmentLabelDe } from "./employment";
import { publicHolidayNames, publicHolidays } from "./holidays";
import { resolveDay } from "./workHours";
import { format } from "date-fns";

/** Dateiname säubern: Umlaute/Akzente weg, nur unbedenkliche Zeichen behalten. */
export function safeFileName(text: string): string {
  const plain = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // Akzente entfernen: "Tuấn" -> "Tuan"
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
  return plain.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "Stundenzettel";
}

// ── Text für die eingebaute Schrift aufbereiten ────────────────────────────
// Helvetica kann Latin-1 (inkl. ä ö ü ß). Alles darüber (vietnamesische
// Diakritika, Typo-Anführungszeichen, Gedankenstrich) wird auf ein passendes
// ASCII/Latin-1-Zeichen abgebildet, damit nie ein Kästchen/"?" erscheint.
const PUNCT: Record<string, string> = {
  "–": "-", // – en dash
  "—": "-", // — em dash
  "‘": "'",
  "’": "'",
  "‚": ",",
  "“": '"',
  "”": '"',
  "„": '"',
  "…": "...",
  " ": " ", // geschütztes Leerzeichen
};

export function pdfText(input: string | undefined | null): string {
  if (!input) return "";
  let out = "";
  for (const ch of input.normalize("NFC")) {
    const code = ch.codePointAt(0) ?? 0;
    if (PUNCT[ch]) {
      out += PUNCT[ch];
    } else if ("äöüÄÖÜß".includes(ch) || code < 0xc0) {
      // Latin-1: Deutsch inkl. Umlaute/ß bleibt erhalten.
      out += ch;
    } else if (ch === "đ" || ch === "Đ") {
      out += ch === "đ" ? "d" : "D";
    } else {
      // z. B. vietnamesische Vokale: zerlegen und Diakritika entfernen.
      const stripped = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      out += /^[\x20-\xff]*$/.test(stripped) ? stripped : "";
    }
  }
  return out;
}

// ── gemeinsame Farb-/Maß-Konstanten ────────────────────────────────────────
const INK: [number, number, number] = [15, 23, 42]; // slate-900
const MUTED: [number, number, number] = [100, 116, 139]; // slate-500
const LINE: [number, number, number] = [71, 85, 105]; // slate-600
const GRID: [number, number, number] = [148, 163, 184]; // slate-400
const HEAD_FILL: [number, number, number] = [241, 245, 249]; // slate-100
const SHADE_FILL: [number, number, number] = [248, 250, 252]; // slate-50
const DIVIDER: [number, number, number] = [203, 213, 225]; // slate-300

const MARGIN = 14; // mm

function monthLabelDe(year: number, month: number): string {
  return `${MONTH_NAMES_DE[month - 1]} ${year}`;
}

/** Kopfzeile (Titel links, Zeitraum rechts) + Trennlinie. Gibt neues Y zurück. */
function drawHeader(
  doc: jsPDF,
  title: string,
  schedule: Schedule,
  periodLabel: string,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  let y = MARGIN + 1;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  doc.text(pdfText(title), MARGIN, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...LINE);
  doc.text(pdfText(periodLabel), pageW - MARGIN, y, { align: "right" });

  y += 4.5;
  doc.setFontSize(9);
  doc.setTextColor(...LINE);
  doc.text(pdfText(schedule.companyName || "—"), MARGIN, y);
  if (schedule.address) {
    y += 3.6;
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(pdfText(schedule.address), MARGIN, y);
  }

  y += 2.4;
  doc.setDrawColor(30, 41, 59); // slate-800
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, pageW - MARGIN, y);
  return y + 4;
}

/** Zweispaltiger Info-Block; gibt das Y darunter zurück. */
function drawInfoBlock(
  doc: jsPDF,
  pairs: Array<[string, string | null]>, // null = Feld zum Ausfüllen von Hand
  startY: number,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const colX = [MARGIN, pageW / 2 + 4];
  const labelW = 32;
  let y = startY;
  doc.setFontSize(8);

  for (let i = 0; i < pairs.length; i += 2) {
    for (let c = 0; c < 2; c++) {
      const pair = pairs[i + c];
      if (!pair) continue;
      const [label, value] = pair;
      const x = colX[c];
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...MUTED);
      doc.text(`${pdfText(label)}:`, x, y);
      if (value === null) {
        // Leere Schreiblinie – wird auf dem Papier von Hand ergänzt.
        doc.setDrawColor(...GRID);
        doc.setLineWidth(0.2);
        doc.line(x + labelW, y, x + labelW + 45, y);
      } else {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...INK);
        const valueWidth = (pageW - 2 * MARGIN) / 2 - labelW - 6;
        const width = doc.getTextWidth(pdfText(value));
        doc.setFontSize(Math.min(8, 8 * valueWidth / Math.max(width, 1)));
        doc.text(pdfText(value), x + labelW, y);
        doc.setFontSize(8);
      }
    }
    y += 5;
  }
  return y + 1;
}

/** Unterschriftszeilen am Seitenende. */
function drawSignatures(doc: jsPDF, labels: string[], y: number): void {
  const pageW = doc.internal.pageSize.getWidth();
  const gap = (pageW - 2 * MARGIN) / labels.length;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...LINE);
  labels.forEach((label, i) => {
    const x0 = MARGIN + i * gap;
    const x1 = x0 + gap - 10;
    doc.line(x0, y, x1, y);
    doc.text(pdfText(label), x0, y + 4);
  });
}

// ── Stundenzettel ──────────────────────────────────────────────────────────

type DayRow = {
  shaded: boolean;
  shiftCount: number;
  segments: string[][];
  cells: string[]; // [datum/wd, beginn, ende, pause, arbeitszeit, bemerkung]
};

function stundenzettelRowsFor(
  schedule: Schedule,
  employee: Employee,
  dates: string[],
): { rows: DayRow[]; totalMinutes: number } {
  const byDate = new Map<string, Shift[]>();
  for (const s of schedule.shifts) {
    if (s.employeeId !== employee.id) continue;
    const list = byDate.get(s.date);
    if (list) list.push(s);
    else byDate.set(s.date, [s]);
  }
  for (const list of byDate.values()) list.sort((a, b) => a.startMinutes - b.startMinutes);

  const holidayNames = publicHolidayNames(schedule.year);
  const overrides = Object.fromEntries(schedule.dateOverrides.map((o) => [o.date, o]));
  const holidays = publicHolidays(schedule.year);

  let totalMinutes = 0;
  const rows: DayRow[] = dates.map((d) => {
    const dienste = byDate.get(d) ?? [];
    totalMinutes += dienste.reduce((a, s) => a + s.paidMinutes, 0);
    const wd = WEEKDAY_LABELS_DE[weekdayKeyOf(parseIsoDate(d))];
    const holiday = holidayNames.get(d);
    const override = overrides[d];
    const closed = resolveDay(schedule.workHours, d, holidays, overrides).closed;
    const isWeekend = wd === "Samstag" || wd === "Sonntag";
    const shaded = Boolean(isWeekend || holiday || closed || !dienste.length);
    const datum = `${format(parseIsoDate(d), "dd.MM.yyyy")}\n${wd}`;

    if (dienste.length === 0) {
      const bemerkung = closed
        ? override?.note || "Frei (Betriebsruhe)"
        : holiday
          ? `Frei (Feiertag: ${holiday})`
          : "Frei";
      return { shaded, shiftCount: 0, segments: [], cells: [datum, "", "", "", "0,00", bemerkung] };
    }

    const beginn = dienste.map((x) => minutesToTime(x.startMinutes)).join("\n");
    const ende = dienste.map((x) => minutesToTime(x.endMinutes)).join("\n");
    const pause = dienste.map((x) => `${x.pauseMinutes} Min`).join("\n");
    const arbeitszeit = dienste.map((x) => minutesToDecimalHours(x.paidMinutes)).join("\n");
    const bemerkung = [holiday ? `Feiertag: ${holiday}` : "", override?.note ?? "",
      ...dienste.flatMap((x) => (x.serviceCoverWindows ?? []).map((w) => `Service ${minutesToTime(w.startMinutes)}-${minutesToTime(w.endMinutes)}`)),
    ].filter(Boolean).join("\n");
    return {
      shaded,
      shiftCount: dienste.length,
      segments: dienste.map((x) => [minutesToTime(x.startMinutes), minutesToTime(x.endMinutes),
        `${x.pauseMinutes} Min${x.pauseMinutes > 0 && x.pauseStartMinutes != null ? `\n${minutesToTime(x.pauseStartMinutes)}-${minutesToTime(x.pauseStartMinutes + x.pauseMinutes)}` : ""}`,
        minutesToDecimalHours(x.paidMinutes)]),
      cells: [datum, beginn, ende, pause, arbeitszeit, bemerkung],
    };
  });

  return { rows, totalMinutes };
}

// Spalten des Stundenzettels: x-Position, Breite, Ausrichtung. Rechte Kante 196.
const SZ_COLS: Array<{ x: number; w: number; align: "left" | "center" }> = [
  { x: 14, w: 30, align: "left" }, // Datum / Wochentag
  { x: 44, w: 26, align: "center" }, // Arbeitsbeginn
  { x: 70, w: 26, align: "center" }, // Arbeitsende
  { x: 96, w: 20, align: "center" }, // Pause
  { x: 116, w: 26, align: "center" }, // Arbeitszeit
  { x: 142, w: 54, align: "left" }, // Bemerkung
];
const SZ_LEFT = 14;
const SZ_RIGHT = 196;
const SZ_HEAD = ["Datum / Wochentag", "Arbeitsbeginn", "Arbeitsende", "Pause", "Arbeitszeit", "Bemerkung"];

/**
 * Zeichnet die Stundenzettel-Tabelle VON HAND (jsPDF-Primitive, ohne autoTable).
 *
 * Warum von Hand: die eingebundene autoTable-Version berechnet zwar alle Zeilen,
 * zeichnet im minifizierten Bundle aber nur einen Teil (ein ganzer Monat wurde
 * ab ~Tag 23 abgeschnitten). Selbst gezeichnet haben wir volle Kontrolle über die
 * Zeilenhöhe – ein ganzer Monat passt garantiert auf EINE Seite – und es gibt
 * keine Fremd-Bibliothek mehr, die Zeilen verschluckt.
 */
function drawStundenzettelTable(
  doc: jsPDF,
  startY: number,
  rows: DayRow[],
  totalMinutes: number,
): void {
  const baseFont = 6.5;
  const lineHeight = 2.5;
  const padding = 0.6;
  doc.setFontSize(baseFont);
  doc.setFont("helvetica", "normal");
  const wrap = (text: string, width: number): string[] => pdfText(text).split("\n").flatMap((part) =>
    part ? doc.splitTextToSize(part, width - 3) as string[] : [""]);
  const content = rows.map((row) => {
    const date = wrap(row.cells[0], SZ_COLS[0].w);
    const note = wrap(row.cells[5], SZ_COLS[5].w);
    const segments = row.segments.map((cells) => cells.map((text, i) => wrap(text, SZ_COLS[i + 1].w)));
    const segmentHeights = segments.map((cells) => Math.max(...cells.map((lines) => lines.length)) * lineHeight + 2 * padding);
    const height = Math.max(date.length * lineHeight + 2 * padding, note.length * lineHeight + 2 * padding,
      segmentHeights.reduce((sum, h) => sum + h, 0));
    return { date, note, segments, segmentHeights, height };
  });
  const headH = 5;
  const footH = 5;
  const available = doc.internal.pageSize.getHeight() - 36 - startY - headH - footH;
  const scale = Math.min(1, available / content.reduce((sum, row) => sum + row.height, 0));
  const font = baseFont * scale;
  const lh = lineHeight * scale;
  const drawText = (text: string, ci: number, baseline: number, bold = false) => {
    if (!text) return;
    const col = SZ_COLS[ci];
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setTextColor(...INK);
    doc.text(text, col.align === "center" ? col.x + col.w / 2 : col.x + 1.5, baseline, { align: col.align });
  };
  const cell = (lines: string[], ci: number, top: number, height: number, bold = false) => {
    const offset = (height - lines.length * lh) / 2;
    lines.forEach((line, i) => drawText(line, ci, top + offset + (i + 0.76) * lh, bold && i === 0));
  };
  doc.setFillColor(...HEAD_FILL);
  doc.rect(SZ_LEFT, startY, SZ_RIGHT - SZ_LEFT, headH, "F");
  doc.setFontSize(baseFont);
  SZ_HEAD.forEach((text, ci) => drawText(text, ci, startY + 3.4, true));
  let y = startY + headH;
  const edges = [startY, y];
  const separators: number[] = [];
  doc.setFontSize(font);
  rows.forEach((row, index) => {
    const data = content[index];
    const h = data.height * scale;
    if (row.shaded) {
      doc.setFillColor(...SHADE_FILL);
      doc.rect(SZ_LEFT, y, SZ_RIGHT - SZ_LEFT, h, "F");
    }
    cell(data.date, 0, y, h, true);
    cell(data.note, 5, y, h);
    if (!data.segments.length) cell(["0,00"], 4, y, h);
    let segmentY = y;
    const totalSegmentHeight = data.segmentHeights.reduce((sum, value) => sum + value, 0);
    data.segments.forEach((cells, i) => {
      const segmentH = h * data.segmentHeights[i] / totalSegmentHeight;
      cells.forEach((lines, ci) => cell(lines, ci + 1, segmentY, segmentH));
      segmentY += segmentH;
      if (i < data.segments.length - 1) separators.push(segmentY);
    });
    y += h;
    edges.push(y);
  });
  doc.setFontSize(baseFont);
  doc.setFillColor(...HEAD_FILL);
  doc.rect(SZ_LEFT, y, SZ_RIGHT - SZ_LEFT, footH, "F");
  drawText("Gesamtstunden", 0, y + 3.4, true);
  drawText(minutesToDecimalHours(totalMinutes), 4, y + 3.4, true);
  y += footH;
  edges.push(y);
  // Draw borders last, on top of every fill. All rows share exact column edges.
  doc.setDrawColor(...GRID);
  doc.setLineWidth(0.2);
  edges.forEach((edge) => doc.line(SZ_LEFT, edge, SZ_RIGHT, edge));
  [SZ_LEFT, ...SZ_COLS.slice(1).map((col) => col.x), SZ_RIGHT].forEach((x) => doc.line(x, startY, x, y));
  doc.setDrawColor(...DIVIDER);
  separators.forEach((edge) => doc.line(SZ_COLS[1].x, edge, SZ_COLS[5].x, edge));

}

/** Zeichnet EINEN Stundenzettel auf die aktuelle Seite. */
function drawStundenzettel(
  doc: jsPDF,
  schedule: Schedule,
  employee: Employee,
  dates: string[],
  periodLabel: string,
): void {
  const startY = drawHeader(doc, "Stundenaufzeichnung", schedule, periodLabel);
  const infoY = drawInfoBlock(
    doc,
    [
      ["Firmenname", schedule.companyName || "—"],
      ["Beschäftigungsart", employmentLabelDe(employee.employmentType)],
      ["Mitarbeiter", employee.name],
      ["Monat", MONTH_NAMES_DE[schedule.month - 1]],
      ["Sollstunden", null], // von Hand einzutragen
      ["Jahr", String(schedule.year)],
    ],
    startY,
  );

  const { rows, totalMinutes } = stundenzettelRowsFor(schedule, employee, dates);

  drawStundenzettelTable(doc, infoY, rows, totalMinutes);

  // Zusammenfassung + Unterschriften: FESTE Positionen im reservierten Band am
  // Seitenende – unabhängig davon, wo die Tabelle endet (keine Kollision mehr).
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  const summaryY = pageH - 30;
  const col3 = (pageW - 2 * MARGIN) / 3;

  const summary: Array<[string, string | null]> = [
    ["Gesamtstunden", `${minutesToDecimalHours(totalMinutes)} h`],
    ["Sollstunden", null],
    ["Differenz", null],
  ];
  summary.forEach(([label, value], i) => {
    const x = MARGIN + i * col3;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(pdfText(label), x, summaryY);
    if (value === null) {
      doc.setDrawColor(...GRID);
      doc.setLineWidth(0.2);
      doc.line(x, summaryY + 5, x + 26, summaryY + 5);
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...INK);
      doc.text(pdfText(value), x, summaryY + 5);
    }
  });

  drawSignatures(
    doc,
    ["Unterschrift Mitarbeiter", "Unterschrift Arbeitgeber", "Datum"],
    pageH - 14,
  );
}

/**
 * Baut die Stundenzettel-PDF: eine A4-Seite je Mitarbeiter.
 * `dates` fehlt => ganzer Monat; `periodLabel` fehlt => Monat/Jahr.
 *
 * async + kurzer Yield je Seite: der Fortschritt (X/N) kann gerendert werden
 * und der Haupt-Thread bleibt auch auf schwachen Handys frei. Die Ausgabe
 * selbst ist trotzdem rein deterministisch – der Yield ändert nichts am Inhalt.
 */
export async function buildStundenzettelPdf(
  schedule: Schedule,
  employees: Employee[],
  opts: { dates?: string[]; periodLabel?: string } = {},
  onProgress?: (current: number, total: number) => void,
): Promise<jsPDF> {
  if (!employees.length || !schedule.shifts.length) throw new Error("Chưa có lịch hoặc chưa chọn nhân viên.");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  const dates = opts.dates ?? datesOfMonth(schedule.year, schedule.month);
  const periodLabel = opts.periodLabel ?? monthLabelDe(schedule.year, schedule.month);

  onProgress?.(0, employees.length);
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < employees.length; i++) {
    if (i > 0) doc.addPage();
    drawStundenzettel(doc, schedule, employees[i], dates, periodLabel);
    onProgress?.(i + 1, employees.length);
    await new Promise((r) => setTimeout(r, 0));
  }

  return doc;
}

// ── Datei ausliefern ─────────────────────────────────────────────────────────

/**
 * PDF-Blob direkt als Datei herunterladen. MIME application/octet-stream +
 * .pdf-Name => auch iOS Safari / In-App-Browser speichern die Datei, statt sie
 * in einen neuen Tab zu öffnen und dort hängen zu bleiben.
 */
export function deliver(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  const octet = new Blob([blob], { type: "application/octet-stream" });
  const url = URL.createObjectURL(octet);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (document.body.contains(a)) document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 60_000);
}

/** jsPDF-Dokument als Datei speichern. */
export function savePdf(doc: jsPDF, filename: string): void {
  deliver(doc.output("blob"), filename);
}
