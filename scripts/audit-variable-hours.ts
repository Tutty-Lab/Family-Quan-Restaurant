// Reproduce with: npx vite-node scripts/audit-variable-hours.ts
// Uses isolated sample data; never reads/writes the live app or its storage.
import { mkdirSync, writeFileSync } from "node:fs";
import { createInitialSchedule } from "../src/lib/sampleData";
import { generateSchedule } from "../src/lib/scheduler";
import { analyzeRoleCoverage, serviceCoverageErrors } from "../src/lib/serviceCoverage";
import { validateSchedule } from "../src/lib/validation";
import { monthlyTargetMinutes } from "../src/lib/contract";
import { datesOfMonth } from "../src/lib/demand";
import { publicHolidays } from "../src/lib/holidays";
import { resolveDay } from "../src/lib/workHours";
import { daysBetween } from "../src/lib/consecutive";

import { weeklyDistributionWarnings } from "../src/lib/weeklyDistribution";

const samples = [
  { name: "Gốc", hours: [10.5, 10, 10, 12] },
  { name: "Chuyển giờ giữa bồi", hours: [9.5, 10.5, 10.5, 12] },
  { name: "Tăng nhẹ", hours: [11, 10.5, 10.5, 12.5] },
  { name: "Tăng 1–2 giờ", hours: [12, 11, 11, 13] },
  { name: "Tăng đều", hours: [12, 12, 12, 14] },
  { name: "Tăng giảm hỗn hợp", hours: [9, 11, 10.5, 11] },
  { name: "Giảm nhẹ", hours: [10, 10, 10, 11] },
  { name: "Giảm cả nhóm", hours: [9.5, 9.5, 9.5, 11] },
  { name: "Giờ lẻ 0,25", hours: [10.25, 10.25, 10.25, 12.5] },
];
const ids = ["ma-3", "ma-4", "ma-5", "ma-6"];
const records: any[] = [];

for (const sample of samples) for (const month of [2, 9, 10]) {
  const schedule = { ...createInitialSchedule(), month };
  for (const [i, id] of ids.entries()) schedule.employees.find((e) => e.id === id)!.weeklyHours = sample.hours[i];
  const days = datesOfMonth(schedule.year, month).map((date) => ({
    date, day: resolveDay(schedule.workHours, date, publicHolidays(schedule.year)),
  })).filter(({ day }) => !day.closed);
  const neededHours = days.reduce((n, { day }) => n + day.blocks.reduce((m, b) => m + b.endMinutes - b.startMinutes, 0), 0) / 60;
  const serviceHours = schedule.employees.filter((e) => e.workRole === "SERVICE")
    .reduce((n, e) => n + monthlyTargetMinutes(e, days.length), 0) / 60;
  const record: any = { sample: sample.name, month, weeklyHours: sample.hours, serviceHours, neededHours,
    capacityDeficitHours: Math.max(0, neededHours - serviceHours) };
  try {
    const started = Date.now();
    schedule.shifts = generateSchedule(schedule);
    record.ownerServiceHours = schedule.shifts.reduce((sum, s) => sum + (s.serviceCoverWindows ?? [])
      .reduce((minutes, w) => minutes + w.endMinutes - w.startMinutes, 0), 0) / 60;
    record.generationMs = Date.now() - started;
    const validation = validateSchedule(schedule.employees, schedule.shifts, schedule.year, days.length);
    record.employees = validation.summaries.map((s) => ({ id: s.employee.id,
      weeklyHours: s.employee.weeklyHours, targetHours: s.targetMinutes / 60,
      actualHours: s.assignedMinutes / 60, diffHours: s.diffMinutes / 60, shifts: s.shiftCount,
    }));
    record.allTargetsMet = record.employees.every((e: any) => e.diffHours === 0);
    record.validationErrors = validation.errors;
    record.emptyWeeks = weeklyDistributionWarnings(schedule.employees, schedule.shifts, days.map((d) => d.date), (date) => resolveDay(schedule.workHours, date, publicHolidays(schedule.year)));
    record.coverage = {};
    for (const role of ["KITCHEN", "SERVICE"] as const) {
      const coverage = analyzeRoleCoverage(schedule, role);
      record.coverage[role] = { failedDays: coverage.filter((d) => !d.ok).length,
        gaps: coverage.flatMap((d) => d.gaps.map((g) => ({ date: d.date, ...g }))),
        missingBreaks: coverage.flatMap((d) => d.breaks.filter((b) => b.start == null).map((b) => ({ date: d.date, employeeId: b.employeeId }))),
        errors: serviceCoverageErrors(coverage, role),
      };
    }
    record.restErrors = [];
    for (const emp of schedule.employees) {
      const own = schedule.shifts.filter((s) => s.employeeId === emp.id);
      const dates = [...new Set(own.map((s) => s.date))].sort();
      for (let i = 1; i < dates.length; i++) {
        const prev = Math.max(...own.filter((s) => s.date === dates[i - 1]).map((s) => s.endMinutes));
        const next = Math.min(...own.filter((s) => s.date === dates[i]).map((s) => s.startMinutes));
        const rest = daysBetween(dates[i - 1], dates[i]) * 1440 + next - prev;
        if (rest < 660) record.restErrors.push({ employeeId: emp.id, date: dates[i], restMinutes: rest });
      }
    }
    record.windowErrors = schedule.shifts.filter((s) => {
      const day = days.find((d) => d.date === s.date)?.day;
      return !day || !day.blocks.some((b) => s.startMinutes >= b.startMinutes && s.endMinutes <= b.endMinutes);
    }).map((s) => s.id);
    record.shortShifts = { oneHour: schedule.shifts.filter((s) => s.paidMinutes === 60).length,
      twoHours: schedule.shifts.filter((s) => s.paidMinutes === 120).length };
    record.pass = record.allTargetsMet && record.emptyWeeks.length === 0 && validation.valid && record.restErrors.length === 0 && record.windowErrors.length === 0 &&
      Object.values(record.coverage).every((c: any) => c.failedDays === 0);
  } catch (err) {
    record.pass = false;
    record.generationError = err instanceof Error ? err.message : String(err);
  }
  records.push(record);
  console.log(JSON.stringify({ sample: record.sample, month, pass: record.pass, deficit: record.capacityDeficitHours,
    targets: record.allTargetsMet, kitchen: record.coverage?.KITCHEN.failedDays, service: record.coverage?.SERVICE.failedDays,
    short: record.shortShifts, error: record.generationError }));
}

const report = [
  "# Kiểm thử biến động giờ Family Quan — 2026-09-23",
  "",
  "Dữ liệu độc lập lấy từ createInitialSchedule, không thay đổi live preview hay dữ liệu thật. Vollzeit giữ nguyên 40h/tuần mỗi người; chủ quán 63h/tuần. Bốn người thay đổi giờ hiện mang loại MINIJOB trong dữ liệu mẫu, không đổi loại hợp đồng.",
  "",
  "Thứ tự giờ: Đậu Thi Huấn (bồi), Su Phuong Anh (bồi), Nguyen Thi Phuong Liên (bồi), Nguyen Thi Phương Lan (bếp). Đơn vị: giờ/tuần. Giờ tháng vẫn theo phép làm tròn hiện tại của ứng dụng.",
  "",
  "Đạt = không có tuần bán thời gian trống khi có ngày được phép làm, đúng định mức tất cả mọi người, validation không có lỗi đỏ, phủ cả hai vai trò có trừ pause, nghỉ giữa ngày ít nhất 11h, ca nằm trong giờ mở cửa. Giờ bồi trong bảng chỉ tính hợp đồng nhóm bồi, chưa cộng giờ chủ phụ bồi. Thiếu giờ riêng nhóm bồi không còn chứng minh bất khả thi khi chủ được phép hỗ trợ; kết quả độ phủ vẫn phải kiểm tra theo từng khung giờ.",
  "",
  "| Mẫu | Giờ/tuần (4 người) | Tháng | Giờ bồi / cần | Chủ phụ bồi (h) | Đúng định mức | Ngày lỗi bếp / bồi | Ca 1h / 2h | Kết quả |",
  "|---|---|---|---|---|---|---|---|---|",
  ...records.map((r) => `| ${r.sample} | ${r.weeklyHours.join(" / ")} | ${r.month} | ${r.serviceHours} / ${r.neededHours} | ${r.ownerServiceHours ?? 0} | ${r.allTargetsMet ? "Có" : "Không"} | ${r.coverage?.KITCHEN.failedDays ?? "—"} / ${r.coverage?.SERVICE.failedDays ?? "—"} | ${r.shortShifts?.oneHour ?? "—"} / ${r.shortShifts?.twoHours ?? "—"} | ${r.pass ? "Đạt" : "Không đạt: xem JSON"} |`),
  "", `Tổng: ${records.filter((r) => r.pass).length}/${records.length} mẫu đạt. Chi tiết từng người, từng ngày và lỗi nằm trong variable-hours.json.`,
  "", "Chạy lại: `npx vite-node scripts/audit-variable-hours.ts`", "",
];
mkdirSync("docs/audits", { recursive: true });
writeFileSync("docs/audits/variable-hours.json", JSON.stringify(records, null, 2) + "\n");
writeFileSync("docs/audits/variable-hours.md", report.join("\n"));
