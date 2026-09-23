# Kiểm thử biến động giờ Family Quan — 2026-09-23

Dữ liệu độc lập lấy từ createInitialSchedule, không thay đổi live preview hay dữ liệu thật. Vollzeit giữ nguyên 40h/tuần mỗi người; chủ quán 63h/tuần. Bốn người thay đổi giờ hiện mang loại MINIJOB trong dữ liệu mẫu, không đổi loại hợp đồng.

Thứ tự giờ: Đậu Thi Huấn (bồi), Su Phuong Anh (bồi), Nguyen Thi Phuong Liên (bồi), Nguyen Thi Phương Lan (bếp). Đơn vị: giờ/tuần. Giờ tháng vẫn theo phép làm tròn hiện tại của ứng dụng.

Đạt = không có tuần bán thời gian trống khi có ngày được phép làm, đúng định mức tất cả mọi người, validation không có lỗi đỏ, phủ cả hai vai trò có trừ pause, nghỉ giữa ngày ít nhất 11h, ca nằm trong giờ mở cửa. Giờ bồi trong bảng chỉ tính hợp đồng nhóm bồi, chưa cộng giờ chủ phụ bồi. Thiếu giờ riêng nhóm bồi không còn chứng minh bất khả thi khi chủ được phép hỗ trợ; kết quả độ phủ vẫn phải kiểm tra theo từng khung giờ.

| Mẫu | Giờ/tuần (4 người) | Tháng | Giờ bồi / cần | Chủ phụ bồi (h) | Đúng định mức | Ngày lỗi bếp / bồi | Ca 1h / 2h | Kết quả |
|---|---|---|---|---|---|---|---|---|
| Gốc | 10.5 / 10 / 10 / 12 | 2 | 282 / 280 | 8 | Có | 0 / 0 | 1 / 2 | Đạt |
| Gốc | 10.5 / 10 / 10 / 12 | 9 | 302 / 300 | 6 | Có | 0 / 0 | 0 / 3 | Đạt |
| Gốc | 10.5 / 10 / 10 / 12 | 10 | 312 / 310 | 11 | Có | 0 / 0 | 1 / 7 | Đạt |
| Chuyển giờ giữa bồi | 9.5 / 10.5 / 10.5 / 12 | 2 | 282 / 280 | 11 | Có | 0 / 0 | 0 / 6 | Đạt |
| Chuyển giờ giữa bồi | 9.5 / 10.5 / 10.5 / 12 | 9 | 302 / 300 | 6 | Có | 0 / 0 | 0 / 3 | Đạt |
| Chuyển giờ giữa bồi | 9.5 / 10.5 / 10.5 / 12 | 10 | 313 / 310 | 12 | Có | 0 / 0 | 0 / 5 | Đạt |
| Tăng nhẹ | 11 / 10.5 / 10.5 / 12.5 | 2 | 288 / 280 | 7 | Có | 0 / 0 | 0 / 1 | Đạt |
| Tăng nhẹ | 11 / 10.5 / 10.5 / 12.5 | 9 | 308 / 300 | 4 | Có | 0 / 0 | 0 / 1 | Đạt |
| Tăng nhẹ | 11 / 10.5 / 10.5 / 12.5 | 10 | 320 / 310 | 4 | Có | 0 / 0 | 0 / 2 | Đạt |
| Tăng 1–2 giờ | 12 / 11 / 11 / 13 | 2 | 296 / 280 | 2 | Có | 0 / 0 | 0 / 0 | Đạt |
| Tăng 1–2 giờ | 12 / 11 / 11 / 13 | 9 | 316 / 300 | 0 | Có | 0 / 0 | 0 / 0 | Đạt |
| Tăng 1–2 giờ | 12 / 11 / 11 / 13 | 10 | 328 / 310 | 3 | Có | 0 / 0 | 0 / 1 | Đạt |
| Tăng đều | 12 / 12 / 12 / 14 | 2 | 304 / 280 | 1 | Có | 0 / 15 | 0 / 0 | Không đạt: xem JSON |
| Tăng đều | 12 / 12 / 12 / 14 | 9 | 324 / 300 | 0 | Có | 0 / 0 | 0 / 0 | Đạt |
| Tăng đều | 12 / 12 / 12 / 14 | 10 | 336 / 310 | 0 | Có | 0 / 20 | 0 / 0 | Không đạt: xem JSON |
| Tăng giảm hỗn hợp | 9 / 11 / 10.5 / 11 | 2 | 282 / 280 | 11 | Có | 0 / 0 | 1 / 4 | Đạt |
| Tăng giảm hỗn hợp | 9 / 11 / 10.5 / 11 | 9 | 302 / 300 | 6 | Có | 0 / 0 | 1 / 2 | Đạt |
| Tăng giảm hỗn hợp | 9 / 11 / 10.5 / 11 | 10 | 313 / 310 | 7 | Có | 0 / 0 | 1 / 4 | Đạt |
| Giảm nhẹ | 10 / 10 / 10 / 11 | 2 | 280 / 280 | 12 | Có | 0 / 0 | 0 / 5 | Đạt |
| Giảm nhẹ | 10 / 10 / 10 / 11 | 9 | 300 / 300 | 6 | Có | 0 / 0 | 1 / 2 | Đạt |
| Giảm nhẹ | 10 / 10 / 10 / 11 | 10 | 309 / 310 | 0 | Có | 0 / 27 | 0 / 0 | Không đạt: xem JSON |
| Giảm cả nhóm | 9.5 / 9.5 / 9.5 / 11 | 2 | 274 / 280 | 0 | Có | 0 / 24 | 0 / 0 | Không đạt: xem JSON |
| Giảm cả nhóm | 9.5 / 9.5 / 9.5 / 11 | 9 | 294 / 300 | 2 | Có | 0 / 25 | 0 / 3 | Không đạt: xem JSON |
| Giảm cả nhóm | 9.5 / 9.5 / 9.5 / 11 | 10 | 303 / 310 | 0 | Có | 0 / 27 | 0 / 1 | Không đạt: xem JSON |
| Giờ lẻ 0,25 | 10.25 / 10.25 / 10.25 / 12.5 | 2 | 283 / 280 | 11 | Có | 0 / 0 | 0 / 6 | Đạt |
| Giờ lẻ 0,25 | 10.25 / 10.25 / 10.25 / 12.5 | 9 | 303 / 300 | 6 | Có | 0 / 0 | 0 / 3 | Đạt |
| Giờ lẻ 0,25 | 10.25 / 10.25 / 10.25 / 12.5 | 10 | 312 / 310 | 12 | Có | 0 / 0 | 1 / 7 | Đạt |

Tổng: 21/27 mẫu đạt. Chi tiết từng người, từng ngày và lỗi nằm trong variable-hours.json.

Chạy lại: `npx vite-node scripts/audit-variable-hours.ts`
