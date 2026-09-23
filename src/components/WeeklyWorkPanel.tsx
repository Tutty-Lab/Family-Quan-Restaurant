import type { Schedule } from "../types";
import { weeksOfMonth } from "../lib/weeks";
import { isPartTime, partTimeWeeks } from "../lib/weeklyDistribution";
import { publicHolidays } from "../lib/holidays";
import { resolveDay } from "../lib/workHours";

export function WeeklyWorkPanel({ schedule }: { schedule: Schedule }) {
  const employees = schedule.employees.filter((e) => isPartTime(e) && (e.targetMinutes > 0 || (e.weeklyHours ?? 0) > 0));
  if (!employees.length || !schedule.shifts.length) return null;
  const weeks = weeksOfMonth(schedule.year, schedule.month);
  const dates = weeks.flatMap((w) => w.dates);
  const holidays = publicHolidays(schedule.year);
  const overrides = Object.fromEntries(schedule.dateOverrides.map((o) => [o.date, o]));
  const dayOf = (date: string) => resolveDay(schedule.workHours, date, holidays, overrides);
  return <details className="my-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
    <summary className="cursor-pointer font-medium">Ca bán thời gian theo tuần (kể cả Minijob)</summary>
    <p className="mt-2 text-xs text-slate-600">Ưu tiên 2 ngày làm mỗi tuần; tuần ngắn đầu/cuối tháng ưu tiên 1 ngày. Một ngày có nhiều mảnh ca vẫn tính là 1 ngày làm.</p>
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr><th className="p-2 text-left">Nhân viên</th>{weeks.map((w) => <th key={w.weekStart} className="whitespace-nowrap p-2">{w.label}</th>)}</tr></thead>
        <tbody>{employees.map((e) => {
          const available = new Set(partTimeWeeks(e, dates, dayOf).map((w) => w.week));
          return <tr key={e.id} className="border-t border-slate-100">
            <td className="whitespace-nowrap p-2">{e.name}</td>
            {weeks.map((w) => {
              const count = new Set(schedule.shifts.filter((s) => s.employeeId === e.id && w.dates.includes(s.date)).map((s) => s.date)).size;
              return <td key={w.weekStart} className={`p-2 text-center ${count ? "text-emerald-700" : available.has(w.weekStart) ? "font-medium text-amber-700" : "text-slate-400"}`}>
                {count ? `${count} ca` : available.has(w.weekStart) ? "0 ca" : "—"}
              </td>;
            })}
          </tr>;
        })}</tbody>
      </table>
    </div>
  </details>;
}
