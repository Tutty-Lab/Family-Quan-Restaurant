import { describe, expect, it } from "vitest";
import { safeFileName } from "../pdf";

describe("safeFileName", () => {
  it("entfernt vietnamesische Akzente", () => {
    expect(safeFileName("Nguyễn Văn Tuấn")).toBe("Nguyen_Van_Tuan");
    expect(safeFileName("Đức")).toBe("Duc");
  });

  it("entfernt deutsche Umlaute und ß-fremde Zeichen", () => {
    expect(safeFileName("Jörg Müller")).toBe("Jorg_Muller");
  });

  it("lässt unbedenkliche Zeichen stehen", () => {
    expect(safeFileName("Mai-2026_08")).toBe("Mai-2026_08");
  });

  it("hat immer einen brauchbaren Rückfallwert", () => {
    expect(safeFileName("   ")).toBe("Stundenzettel");
    expect(safeFileName("///")).toBe("Stundenzettel");
  });
});

import { unzlibSync, strFromU8, strToU8 } from "fflate";
import { buildStundenzettelPdf, pdfText } from "../pdf";
import { createInitialSchedule } from "../sampleData";
import { datesOfMonth } from "../demand";
import type { Schedule } from "../../types";

function content(doc: Awaited<ReturnType<typeof buildStundenzettelPdf>>) {
  const raw = strFromU8(new Uint8Array(doc.output("arraybuffer")), true);
  return [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((m) => {
    try { return strFromU8(unzlibSync(strToU8(m[1], true)), true); }
    catch { return m[1]; }
  }).join("\n");
}
function dense(month = 9): Schedule {
  const schedule = { ...createInitialSchedule(), month };
  schedule.shifts = datesOfMonth(2026, month).flatMap((date) => schedule.employees.flatMap((e) => [
    { id: `${e.id}-${date}-a`, date, employeeId: e.id, startMinutes: 600, endMinutes: 840, paidMinutes: 240, pauseMinutes: 0, shiftType: "EARLY" as const, generated: true },
    { id: `${e.id}-${date}-b`, date, employeeId: e.id, startMinutes: 960, endMinutes: 1200, paidMinutes: 240, pauseMinutes: 0, shiftType: "LATE" as const, generated: true },
  ]));
  return schedule;
}

describe("vector timesheets", () => {
  it("transliterates Vietnamese including Latin-1 accents, preserves German and decomposed umlauts", () => {
    expect(pdfText("Nguyễn Kiều Hữu Đức Thị Hà Tú Phương Anh")).toBe("Nguyen Kieu Huu Duc Thi Ha Tu Phuong Anh");
    expect(pdfText("März Beschäftigungsart Jörg Müller Straße")).toBe("März Beschäftigungsart Jörg Müller Straße");
    expect(pdfText("Mu\u0308ller Đa\u0323t")).toBe("Müller Dat");
  });
  for (const month of [9, 10]) it(`fits all split shifts in ${month === 9 ? 30 : 31} days on one vector page`, async () => {
    const schedule = dense(month);
    const doc = await buildStundenzettelPdf(schedule, [schedule.employees[0]]);
    expect(doc.getNumberOfPages()).toBe(1);
    const text = content(doc);
    for (const date of datesOfMonth(2026, month)) {
      const [y, m, d] = date.split("-");
      expect(text).toContain(`${d}.${m}.${y}`);
    }
    expect(text).toContain("Gesamtstunden");
    expect(text).toContain("Unterschrift Mitarbeiter");
    expect(text).toContain("Unterschrift Arbeitgeber");
    expect(text).toContain(month === 9 ? "240,00" : "248,00");
    expect(text).toContain("10:00");
    expect(text).toContain("16:00");
    expect(text).not.toMatch(/vercel\.app|https?:\/\//);
    expect(doc.output()).not.toContain("/Subtype /Image");
    expect(doc.output("arraybuffer").byteLength).toBeLessThan(50_000);
    // Vector strokes are present for both column borders and daily/split lines.
    expect((text.match(/ l\n/g) ?? []).length).toBeGreaterThan(65);
  });
  it("exports each person once and reports progress", async () => {
    const schedule = dense();
    const progress: number[] = [];
    const doc = await buildStundenzettelPdf(schedule, schedule.employees, {}, (i, n) => {
      expect(n).toBe(7); progress.push(i);
    });
    expect(doc.getNumberOfPages()).toBe(7);
    expect(progress).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it("uses only selected dates and preserves exact pause, owner service, holiday, closure and free-day notes", async () => {
    const schedule = dense(10);
    const employee = schedule.employees[0];
    schedule.shifts = [{ ...schedule.shifts[0], date: "2026-10-01", startMinutes: 720, endMinutes: 1320,
      paidMinutes: 540, pauseMinutes: 60, pauseStartMinutes: 1020,
      serviceCoverWindows: [{ startMinutes: 960, endMinutes: 1020 }] }];
    schedule.dateOverrides = [{ date: "2026-10-02", closed: true, note: "Umbau" }];
    const doc = await buildStundenzettelPdf(schedule, [employee], { dates: ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"], periodLabel: "Woche 01.10.-04.10." });
    const text = content(doc);
    expect(text).toContain("60 Min");
    expect(text).toContain("17:00-18:00");
    expect(text).toContain("Service 16:00-17:00");
    expect(text).toContain("Umbau");
    expect(text).toContain("Tag der Deutschen Einheit");
    expect(text).toContain("Frei");
    expect(text).toContain("9,00");
    expect(text).not.toContain("05.10.2026");
  });
  it("rejects empty exports instead of generating a blank page", async () => {
    const schedule = createInitialSchedule();
    await expect(buildStundenzettelPdf(schedule, schedule.employees)).rejects.toThrow("Chưa có lịch");
    await expect(buildStundenzettelPdf(dense(), [])).rejects.toThrow("Chưa có lịch");
  });
});
