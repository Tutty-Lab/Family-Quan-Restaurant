import { useEffect, useMemo, useRef, useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import { StundenzettelPage } from "./StundenzettelPage";
import { weeksOfMonth } from "../lib/weeks";

/** Export timesheets directly from data; the HTML is only an on-screen preview. */
export function StundenzettelTab({ store }: { store: UseScheduleReturn }) {
  const { schedule, isLocked, unlockMonth } = store;
  const [who, setWho] = useState("all");
  const [period, setPeriod] = useState("month");
  const [pdfBusy, setPdfBusy] = useState(false);
  const busy = useRef(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState("");
  const [download, setDownload] = useState<{ url: string; filename: string } | null>(null);
  const downloadUrl = useRef<string | null>(null);
  useEffect(() => () => { if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); }, []);
  const [confirmUnlock, setConfirmUnlock] = useState(false);
  const weeks = useMemo(() => weeksOfMonth(schedule.year, schedule.month), [schedule.year, schedule.month]);
  const week = weeks.find((w) => w.weekStart === period);
  const selectedPeriod = week ? period : "month";
  const selectedWho = schedule.employees.some((e) => e.id === who) ? who : "all";
  const employees = selectedWho === "all" ? schedule.employees : schedule.employees.filter((e) => e.id === selectedWho);
  const preview = employees[0];
  const periodLabel = week ? `Woche ${week.label} ${schedule.year}` : undefined;
  const hasSchedule = schedule.shifts.length > 0 && employees.length > 0;

  async function onPdf() {
    if (busy.current || !hasSchedule) return;
    busy.current = true;
    setPdfBusy(true);
    setError("");
    setProgress({ current: 0, total: employees.length });
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    setDownload(null);
    try {
      const { buildStundenzettelPdf, deliver, safeFileName } = await import("../lib/pdf");
      const doc = await buildStundenzettelPdf(schedule, employees, { dates: week?.dates, periodLabel },
        (current, total) => setProgress({ current, total }));
      const month = `${schedule.year}-${String(schedule.month).padStart(2, "0")}`;
      const name = selectedWho === "all" ? "tat_ca" : safeFileName(preview.name);
      const filename = `Stundenzettel_${name}_${month}${week ? `_tuan_${week.weekStart}` : ""}.pdf`;
      const blob = doc.output("blob");
      // Keep an explicit second-tap download available for restrictive WebViews.
      const url = URL.createObjectURL(new Blob([blob], { type: "application/octet-stream" }));
      downloadUrl.current = url;
      setDownload({ url, filename });
      deliver(blob, filename);
    } catch (err) {
      setError(`Không tạo được PDF: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      busy.current = false;
      setPdfBusy(false);
    }
  }

  return <div className="no-print">
    <div className="rounded-lg border border-slate-200 bg-white p-3 mb-4">
      <div className="text-sm font-medium text-slate-700 mb-2">Xuất bảng chấm công PDF</div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Cho ai</span>
          <select className="rounded border border-slate-300 px-2 py-2 text-sm" value={selectedWho}
            disabled={pdfBusy} onChange={(e) => setWho(e.target.value)}>
            <option value="all">Tất cả (cả quán)</option>
            {schedule.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Nội dung</span>
          <select className="max-w-full rounded border border-slate-300 px-2 py-2 text-sm" value={selectedPeriod}
            disabled={pdfBusy} onChange={(e) => setPeriod(e.target.value)}>
            <option value="month">Bảng chấm công — cả tháng</option>
            {weeks.map((w) => <option key={w.weekStart} value={w.weekStart}>Bảng chấm công — tuần {w.label}</option>)}
          </select>
        </label>
        <button disabled={pdfBusy || !hasSchedule} onClick={() => void onPdf()} aria-busy={pdfBusy}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40">
          {pdfBusy ? `Đang tạo PDF… ${progress.current}/${progress.total}` : "Xuất PDF"}
        </button>
        {pdfBusy && <span role="status" aria-live="polite" className="text-sm text-slate-500">{progress.current}/{progress.total} trang</span>}
      </div>
      {!hasSchedule && <p className="mt-2 text-sm text-slate-500">Chưa có lịch. Thêm nhân viên và tạo lịch trước khi xuất PDF.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
      {download && <p role="status" className="mt-2 text-sm text-emerald-700">
        Đã tạo PDF. Nếu máy chưa tải, <a className="underline font-medium" href={download.url} download={download.filename}>bấm lưu file</a>.
      </p>}
      <p className="mt-2 text-xs text-slate-500">Mỗi người một trang A4, theo tháng hoặc tuần. Tên tiếng Việt trong PDF được bỏ dấu; chữ Đức giữ nguyên. File tải trực tiếp về máy.</p>
          {isLocked && (
            <div className="mt-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2">
              <div className="font-medium">
                Lịch tháng này đã khóa vì đã in
                {schedule.lockedAt &&
                  ` lúc ${new Date(schedule.lockedAt).toLocaleString("vi-VN")}`}
                .
              </div>
              <div className="mt-0.5">
                Không sửa được ca, không đổi nhân viên. Vẫn xuất PDF được bình thường. (Tạo lại lịch ở tab
                „Lịch làm việc" cũng sẽ mở khóa.)
              </div>

              {/*
                Bewusst KEIN window.confirm: In-App-Browser (Messenger,
                Facebook) unterdrücken die native Rückfrage teilweise. Sie
                liefert dann stillschweigend false, der Klick tut nichts, und
                niemand erfährt warum. Die Rückfrage steht deshalb direkt hier.
              */}
              {!confirmUnlock ? (
                <button
                  onClick={() => setConfirmUnlock(true)}
                  className="mt-2 rounded border border-amber-400 bg-white px-3 py-1 text-sm font-medium text-amber-900 hover:bg-amber-100"
                >
                  Mở khóa
                </button>
              ) : (
                <div className="mt-2 rounded border border-amber-300 bg-white px-3 py-2">
                  <div className="text-amber-900">
                    Mở khóa lịch tháng này? Bản đã in ở quán sẽ không còn khớp với hệ thống. Sau
                    khi sửa, hãy xuất lại PDF và thay bản cũ.
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => {
                        unlockMonth();
                        setConfirmUnlock(false);
                      }}
                      className="rounded bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-700"
                    >
                      Xác nhận mở khóa
                    </button>
                    <button
                      onClick={() => setConfirmUnlock(false)}
                      className="rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
                    >
                      Huỷ
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}    </div>
    {preview && <>
      <p className="mb-1 text-xs text-slate-500">Xem trước: <b>{preview.name}</b>{selectedWho === "all" && " (chọn một người để xem người khác)"}</p>
      <div className="rounded-lg border border-slate-300 shadow-sm bg-white overflow-x-auto">
        <StundenzettelPage schedule={schedule} employee={preview} dates={week?.dates} periodLabel={periodLabel} />
      </div>
    </>}
  </div>;
}
