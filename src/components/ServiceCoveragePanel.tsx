import type { Employee, Shift } from "../types";
import type { ServiceDayCoverage } from "../lib/serviceCoverage";
import { minutesToTime } from "../lib/time";

export function BreakLabel({ shift }: { shift: Shift }) {
  if (shift.serviceCoverWindows?.length) return <span>
    {shift.serviceCoverWindows.map((w) => <span key={w.startMinutes} className="block font-medium text-teal-800">
      Phụ bồi {minutesToTime(w.startMinutes)}–{minutesToTime(w.endMinutes)}
    </span>)}
    {shift.pauseStartMinutes != null && shift.pauseMinutes > 0
      ? `Nghỉ ${minutesToTime(shift.pauseStartMinutes)}–${minutesToTime(shift.pauseStartMinutes + shift.pauseMinutes)}`
      : "Chưa xếp giờ nghỉ"}
  </span>;
  if (shift.isBreakCover) return <span className="font-medium text-teal-800">Thay giờ nghỉ</span>;
  if (shift.pauseStartMinutes != null && shift.pauseMinutes > 0) {
    return <span>Nghỉ {minutesToTime(shift.pauseStartMinutes)}–{minutesToTime(shift.pauseStartMinutes + shift.pauseMinutes)}</span>;
  }
  return <span>Nghỉ {shift.pauseMinutes} phút</span>;
}

export function ServiceCoveragePanel({ days, employees, role = "SERVICE" }: {
  days: ServiceDayCoverage[]; employees: Employee[]; role?: "KITCHEN" | "SERVICE";
}) {
  if (days.length === 0) return null;
  const missing = days.filter((day) => !day.ok);
  const names = new Map(employees.map((e) => [e.id, e.name]));
  const good = missing.length === 0;
  const label = role === "KITCHEN" ? "Bếp" : "Bồi";
  return (
    <details className={`my-3 rounded-lg border px-3 py-2 text-sm ${good
      ? "border-teal-200 bg-teal-50 text-teal-900" : "border-rose-200 bg-rose-50 text-rose-900"}`}>
      <summary className="cursor-pointer font-medium">
        {good ? `${label}: đủ người suốt giờ mở cửa, kể cả lúc nghỉ (${days.length} ngày)`
          : `${label}: ${missing.length} ngày thiếu người hoặc chưa bố trí giờ nghỉ`}
        <span className="ml-2 font-normal text-xs">Xem giờ nghỉ &amp; người thay</span>
      </summary>
      <p className="mt-2 text-xs">Số {label.toLowerCase()} được tính theo từng khung giờ, trừ người đang nghỉ.
        {role === "SERVICE" && " Khi tạo lịch, ưu tiên giảm ca ngắn dưới 3 giờ; vẫn có thể còn ca 1–2 giờ thay nghỉ để giữ đúng định mức và đủ bồi."}</p>
      <div className="mt-2 max-h-80 space-y-2 overflow-auto">
        {days.map((day) => (
          <div key={day.date} className="border-t border-current/10 pt-2">
            <div className="font-medium">{day.date.split("-").reverse().join(".")}</div>
            {day.ownerCovers.map((cover) => <p key={`${cover.employeeId}-${cover.start}`}>
              {names.get(cover.employeeId)}: phụ bồi {minutesToTime(cover.start)}–{minutesToTime(cover.end)}
              {role === "KITCHEN" ? " — không tính đứng bếp trong khoảng này." : "."}
            </p>)}
            {day.gaps.map((gap) => <p key={gap.startMinutes} className="text-rose-700">
              {minutesToTime(gap.startMinutes)}–{minutesToTime(gap.endMinutes)}: chưa có {label.toLowerCase()} đang làm.
            </p>)}
            {day.breaks.map((pause) => <p key={pause.shiftId}>
              {names.get(pause.employeeId)}: {pause.start == null ? "chưa xếp giờ nghỉ" :
                `nghỉ ${minutesToTime(pause.start)}–${minutesToTime(pause.end!)}`}.
              {pause.covered ? ` Người thay: ${pause.coveringEmployeeIds.map((id) => names.get(id)).join(", ") || "quán đóng cửa trong giờ nghỉ"}.`
                : " Chưa có người thay đủ thời gian."}
            </p>)}
            {day.breaks.length === 0 && day.ok && <p>Ca nối tiếp; không có giờ nghỉ giữa ca cần người thay.</p>}
          </div>
        ))}
      </div>
    </details>
  );
}
