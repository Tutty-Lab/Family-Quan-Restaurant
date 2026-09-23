# Kiểm chứng PDF vector — 2026-09-24

Phạm vi: Family Quan, chỉ xuất Stundenzettel tháng/tuần. Bỏ nút In, xuất Dienstplan và sân khấu chụp DOM. Không đổi thuật toán hoặc dữ liệu nhân viên.

## Cách xuất

- Vẽ chữ Helvetica, nền ô và đường kẻ bằng jsPDF primitives; không dùng autoTable, canvas hay ảnh trang.
- Tên Việt chuyển ASCII; giữ ä/ö/ü/ß và số thập phân Đức. Không tải font mạng.
- Mỗi người một A4 dọc; chiều cao bảng co theo nội dung, chừa vùng tổng kết và chữ ký cố định.
- Giữ giờ pause và giờ chủ phụ bồi; ca tách có đường kẻ riêng trong ô.
- PDF không đi qua hộp thoại in: không có URL, ngày in hoặc header/footer trình duyệt. Metadata CreationDate của file không phải dòng ngày in trên giấy.
- Tải Blob application/octet-stream, tên .pdf; liên kết lưu lại cho trình duyệt chặn lần tải tự động. Không mở tab mới. Nút và lựa chọn bị disable trong lúc tạo, tiến độ X/N.
- jsPDF vẫn khai báo html2canvas như dependency tùy chọn của chính thư viện; app đã bỏ dependency trực tiếp và pipeline DOM, Vite không đóng gói các plugin HTML/SVG tùy chọn này.

## Đã thực hiện

Bản production: `npm run build`, phục vụ bằng `vite preview` tại 127.0.0.1:5181 (không phải Vite dev).

| Mẫu | Nguồn | Trang | Dung lượng | Kiểm tra |
|---|---|---:|---:|---|
| Cả quán tháng 9, 7 người | Tải thực từ production qua Codex in-app desktop | 7 | 29.327 byte | Mỗi trang đủ 30 ngày; không có Image XObject; tổng giờ và chữ ký |
| Chủ quán, 30 ngày có ca | Tải thực từ production qua Codex in-app desktop | 1 | 6.817 byte | Pause có giờ cụ thể, giờ phụ bồi, tổng 270,00 h |
| Chủ quán tuần 07–13/9 | Tải thực từ production qua Codex in-app desktop | 1 | 4.975 byte | Đúng 7 ngày, tổng 63,00 h |
| Tháng 10, 31 ngày, mỗi ngày 2 ca | Fixture kiểm thử riêng, cùng renderer; không sửa dữ liệu app | 1 | 8.925 byte | Đủ 31 ngày, đường tách ca, lễ 03/10, tổng 248,00 h, chữ ký |

Dùng pypdf đọc lại PDF; dùng Poppler render PNG để xem bảng và chữ ký. Không lấy kết quả Node làm bằng chứng cho production: ba file đầu được tải bằng nút Xuất PDF trong app production.

Chrome desktop thật: mở mới production, tạo lịch và xuất cả quán; đã quan sát trạng thái disable “Đang tạo PDF… 0/7”, hoàn tất và bật lại nút. Console không có warning/error. Chưa xác nhận file Chrome lưu xuống đĩa qua công cụ này. Codex in-app desktop đã xác nhận file tải xuống thư mục Downloads và mở được.

Safari macOS: chưa hoàn tất kiểm thử. Edge, Firefox, iPhone/iPad Safari, Android Chrome, Samsung Internet, Zalo/Facebook/Messenger/Instagram: chưa có kết quả kiểm thử thiết bị thật. Không coi giả lập hay kết quả desktop là bằng chứng các máy này đã đạt. MIME download là cách phân phối theo mẫu người dùng yêu cầu, không bảo đảm mọi WebView cho phép tải file.

## Kiểm tra tự động

- `npx tsc --noEmit`
- `npx vitest run`: 187 kiểm thử.
- `npm run build`
- Tests PDF: chuyển tên Việt và chữ Đức; 30/31 ngày nhiều ca; số trang; tiến độ; tháng/tuần; lễ, đóng cửa, Frei, pause và giờ phụ bồi; không raster; không URL footer; từ chối xuất khi chưa có lịch.
