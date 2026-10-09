# Hephaestus - Từ bản vẽ kỹ thuật đến kiến trúc 3D

## Mục tiêu

Thiết kế giao diện cho phép người dùng nạp bản vẽ kỹ thuật, hệ thống tự phân tích và dựng mô hình kiến trúc xây dựng 3D từ bản vẽ đó. Người dùng có thể xoay, phóng to, di chuyển góc nhìn, chọn cấu kiện và kiểm tra từng tầng ngay trong trình duyệt.

Luồng chính: **Nạp bản vẽ → Phân tích → Dựng mô hình → Tương tác 3D**.

Đây là đặc tả sản phẩm để triển khai tiếp. Chỉ có giao diện hoặc Three.js không đủ để tự hiểu mọi bản vẽ; cần bộ phân tích dữ liệu hình học và dịch vụ nhận dạng cho bản vẽ ảnh/PDF.

## Ngôn ngữ thiết kế

- Thương hiệu Hephaestus, giao diện tiếng Việt.
- Giữ phong cách đen, chữ trắng, tối giản của hero hiện tại; dùng Poppins.
- Mô hình công trình là nội dung chính của canvas. Hiệu ứng kính chỉ dùng làm điểm nhấn nếu không che khuất cấu kiện.
- Bỏ khối kính GLB cố định, headline khúc xạ, số 07 và các chấm chuyển slide khỏi không gian làm việc.
- Khi chưa nạp tệp, hiển thị tiêu đề “Từ bản vẽ đến công trình 3D”, hướng dẫn ngắn và nút “Nạp bản vẽ”.
- Khi có mô hình, thu gọn phần giới thiệu để ưu tiên không gian quan sát.

## Bố cục giao diện

### Thanh trên

Logo Hephaestus bên trái. Tên bản vẽ và trạng thái xử lý ở giữa. Nút “Nạp bản vẽ” và “Xuất mô hình” bên phải. Chỉ bật xuất khi có mô hình hợp lệ.

### Bảng bản vẽ bên trái

- Vùng kéo thả tệp và nút chọn tệp bằng bàn phím.
- Danh sách tệp, trang PDF và tầng liên quan; cho phép chọn trang mặt bằng cần dựng.
- Xem trước bản vẽ 2D, pan/zoom và đánh dấu cấu kiện tương ứng với phần được chọn trong 3D.
- Đơn vị, tỷ lệ bản vẽ và chiều cao tầng. Hiển thị giá trị đọc được hoặc yêu cầu bổ sung khi thiếu.
- Bản vẽ nhiều tầng: hỗ trợ thêm mặt bằng và gán tầng, xác định điểm gốc chung để căn chỉnh.
- Không bắt người dùng khai báo lại dữ liệu đã nhận dạng đủ chắc chắn.

### Canvas 3D trung tâm

- Canvas chiếm phần lớn màn hình, mặc định nền trắng/xám nhạt theo tham chiếu mô hình kiến trúc; có thể chuyển nền tối. Cấu kiện và đường cạnh phải tương phản với nền đang chọn.
- Tự hiển thị mô hình sau khi dựng xong, camera fit toàn bộ công trình.
- Thanh công cụ: “Phối cảnh”, “Mặt bằng”, “Mặt đứng”, “Đặt lại góc nhìn”, “Vừa khung”.
- Bộ chọn tầng, bật/tắt mái, tường, cửa, cột, sàn và kích thước.
- Chuyển giữa “Khối”, “Đường nét”, “Trong suốt”; chế độ trong suốt phục vụ quan sát bên trong.
- Không tự xoay mô hình khi người dùng đang đọc bản vẽ, đo hoặc chọn cấu kiện.

### Bảng thuộc tính bên phải

Khi chọn cấu kiện, hiển thị loại, tầng, kích thước, nguồn bản vẽ và thông tin có sẵn. Cho phép sửa chiều cao, bề dày và vị trí khi dữ liệu nhận dạng chưa đúng. Không hiển thị vật liệu hay kích thước suy đoán như dữ liệu chắc chắn.

### Di động

Canvas ở trung tâm, công cụ có nhãn rõ ràng. Bảng bản vẽ và thuộc tính mở dưới dạng ngăn kéo; không che toàn bộ mô hình cùng lúc. Hỗ trợ một ngón xoay, hai ngón pan/pinch zoom. Không có cuộn ngang trang.

## Tham chiếu kết quả 3D sau khi nạp bản vẽ chi tiết

Ảnh người dùng cung cấp là tham chiếu cho cách trình bày mô hình đầu ra: một công trình kiến trúc nhiều tầng nhìn từ góc phối cảnh trên cao, có nền khu đất, tường bao, sàn, mái, cửa và các cấu kiện bên trong nhìn thấy được.

- Chế độ mặc định sau khi dựng: “Kiến trúc”, nền canvas trắng hoặc xám rất nhạt để đọc rõ hình khối như ảnh tham chiếu. Phần điều khiển bên ngoài canvas vẫn giữ giao diện đen/trắng.
- Mô hình dùng bề mặt trắng/xám trung tính, đường cạnh xám mảnh và bóng tiếp xúc nhẹ; không dùng màu sắc hoặc hiệu ứng khúc xạ làm mất chi tiết bản vẽ.
- Tường, kính và một số bề mặt có thể bán trong suốt để quan sát không gian bên trong. Có điều khiển mức trong suốt; chế độ đặc vẫn phải đọc rõ cấu kiện.
- Tách nhóm tường, sàn, mái, cửa, cửa sổ, cột, cầu thang và phần khu đất khi bản vẽ cung cấp dữ liệu tương ứng.
- Có đường nét mặt bằng trên nền khu đất để đối chiếu vị trí công trình khi nguồn có mặt bằng tổng thể; không tự thêm ranh giới hoặc cảnh quan không có trong dữ liệu.
- Camera ban đầu ở góc phối cảnh chéo từ trên cao, fit toàn bộ công trình và khu đất. Người dùng có thể orbit, pan, zoom và chuyển sang hình chiếu trực giao.
- Bật/tắt mái, ẩn tầng phía trên hoặc dùng mặt cắt để xem các tầng dưới; cấu kiện vẫn chọn được riêng lẻ.
- Ưu tiên chất lượng đường cạnh và thứ tự hiển thị bề mặt trong suốt, tránh nhấp nháy, đường cạnh xuyên sai và che khuất lựa chọn.

Ảnh chỉ quy định phong cách hiển thị và mức chi tiết mong muốn, không phải công trình mẫu để sao chép. Hình khối, số tầng, lỗ mở, cầu thang, cao độ và kích thước phải được dựng từ bản vẽ người dùng nạp. Nếu bản vẽ chưa đủ dữ liệu để tạo chi tiết như ảnh, đánh dấu phần thiếu hoặc giả định và cho phép bổ sung mặt đứng, mặt cắt hoặc thông số.

## Đầu vào và cách dựng mô hình

### Định dạng mục tiêu

- DXF: đọc dữ liệu vector, layer, polyline và đơn vị để dựng hình học.
- PDF: chọn trang; ưu tiên dữ liệu vector nếu có, dùng nhận dạng ảnh khi trang là bản scan.
- PNG/JPG: nhận dạng nét, tường, cửa và vùng phòng; cần xác nhận tỷ lệ nếu không xác định được.
- DWG: chỉ nhận khi đã có dịch vụ chuyển đổi phù hợp; nếu chưa hỗ trợ, hướng dẫn xuất DXF/PDF.
- IFC/GLB/GLTF nếu bổ sung: là nhập mô hình 3D có sẵn, phân biệt rõ với dựng 3D từ bản vẽ 2D.

Chỉ liệt kê định dạng đã triển khai trong bộ chọn tệp. Kiểm tra định dạng thực, dung lượng và lỗi đọc; giới hạn lấy từ cấu hình dịch vụ.

### Pipeline tự động

1. Nhận tệp, xác thực và hiển thị bản vẽ gốc.
2. Trích xuất hình học hoặc nhận dạng cấu kiện theo loại tệp.
3. Chuẩn hóa đơn vị, tỷ lệ, hướng và điểm gốc.
4. Nhận dạng tường, cửa, cửa sổ, cột, sàn và vùng phòng khi dữ liệu cho phép.
5. Dựng tường theo footprint và chiều cao, tạo lỗ mở cửa, đặt cột và sàn theo thông tin đã xác định.
6. Ghép tầng theo cao độ và hệ tọa độ chung; dựng mái/cầu thang khi đủ dữ liệu.
7. Trả mô hình cùng metadata để hiển thị, chọn cấu kiện và đối chiếu với bản vẽ.

Nếu dữ liệu đủ, hoàn tất tự động mà không cần nút “Render” bổ sung. Nếu thiếu thông tin thiết yếu, hiển thị bản xem trước và chỉ hỏi phần còn thiếu, ví dụ tỷ lệ hoặc chiều cao tầng, rồi tiếp tục dựng.

Một mặt bằng 2D thường chưa xác định đầy đủ công trình 3D. Mọi giá trị mặc định phải gắn nhãn “Giả định” và cho phép chỉnh sửa. Không dựng công trình mẫu thay cho nội dung tệp người dùng rồi báo thành công.

## Tương tác mô hình

- Kéo chuột trái để orbit; chuột phải hoặc thao tác pan để dịch góc nhìn; cuộn để zoom.
- Click chọn cấu kiện bằng raycasting; highlight và hiển thị thuộc tính.
- Đồng bộ lựa chọn 2D/3D khi có liên kết nguồn.
- Ẩn/hiện tầng và nhóm cấu kiện; cô lập phần được chọn.
- Công cụ đo khoảng cách theo đơn vị đã xác nhận. Khi chưa có tỷ lệ, không đưa ra số đo thực.
- Mặt cắt điều chỉnh được để quan sát cấu trúc bên trong.
- Sửa tham số cấu kiện phải cập nhật mô hình và hỗ trợ hoàn tác/làm lại.
- Xuất GLB của mô hình hiện tại, giữ cấu trúc cấu kiện và metadata cần thiết.

## Trạng thái và phản hồi

| Trạng thái | Hiển thị và hành động |
| --- | --- |
| Chưa có tệp | Vùng nạp bản vẽ, định dạng hỗ trợ, mô hình mẫu chỉ khi người dùng chọn “Xem ví dụ” |
| Đang tải | Tên tệp, tiến độ tải thực khi có, nút hủy |
| Đang phân tích | Công đoạn hiện tại, giữ bản vẽ 2D để đối chiếu |
| Cần bổ sung | Highlight vùng chưa rõ, yêu cầu tỷ lệ/chiều cao hoặc sửa nhận dạng |
| Đang dựng | Trạng thái dựng hình; không tạo phần trăm giả khi dịch vụ chưa cung cấp |
| Sẵn sàng | Tự fit camera, mở công cụ tương tác và xuất |
| Thất bại | Nguyên nhân có thể xử lý, thử lại hoặc chọn tệp khác; giữ bản vẽ gốc |

Khi thay tệp, giữ mô hình hiện tại cho đến khi mô hình mới hợp lệ. Hủy tác vụ cũ hoặc bỏ qua kết quả cũ để không ghi đè bản vẽ đang mở. Sửa dữ liệu phải được lưu trong trạng thái dự án trước khi dựng lại.

## Yêu cầu triển khai

- Frontend: JavaScript/TypeScript, bun, Vite và Three.js vanilla theo dự án hiện tại.
- OrbitControls cho orbit/pan/zoom; Raycaster cho chọn cấu kiện; clipping planes cho mặt cắt.
- Backend: Python 3.14+, uv; xử lý tệp, chuyển đổi và nhận dạng nặng ngoài luồng render trình duyệt.
- Thiết kế API tác vụ bất đồng bộ: gửi tệp, nhận mã tác vụ, truy vấn trạng thái/hủy và tải mô hình kết quả. Đây là hợp đồng cần triển khai, không giả định API đã tồn tại.
- Kết quả gồm hình học, ID cấu kiện, loại, tầng, đơn vị, giả định và liên kết tới tệp/trang/hình học nguồn nếu có.
- Không merge toàn bộ mô hình thành một mesh làm mất khả năng chọn, ẩn và sửa từng cấu kiện.
- Giữ kích thước thật; fit camera bằng bounding box thay vì scale mô hình về khối có cạnh 1.
- Antialias, pixel ratio tối đa 2; ResizeObserver trên vùng canvas.
- Dùng vật liệu trắng/xám và đường cạnh rõ cấu trúc theo ảnh tham chiếu. Có chế độ bán trong suốt và bóng tiếp xúc nhẹ; không áp shader kính khúc xạ lên toàn bộ công trình.
- Tác vụ parse nặng phía trình duyệt chạy trong Web Worker khi phù hợp.
- Giải phóng geometry, material, texture, renderer và listener khi thay mô hình hoặc teardown.
- Có thông báo khi WebGL không khả dụng; bản vẽ 2D vẫn xem được.
- Tôn trọng prefers-reduced-motion, focus rõ ràng, nút có accessible name, thông báo xử lý bằng aria-live.

Không giữ yêu cầu “một HTML standalone, không backend” của hero cũ cho luồng nhận dạng bản vẽ thật. Bản prototype standalone nếu có phải ghi rõ chức năng mô phỏng và giới hạn định dạng.

## Tiêu chí nghiệm thu

- Nạp bản vẽ thuộc định dạng hỗ trợ và đủ dữ liệu phải tự sinh mô hình tương ứng.
- Bản vẽ thiếu tỷ lệ hoặc chiều cao phải yêu cầu bổ sung hoặc hiển thị giả định rõ ràng.
- Kiểm tra bằng bản vẽ có kích thước chuẩn, so sánh footprint, lỗ mở, số tầng và kích thước 3D với nguồn; ghi rõ sai lệch thay vì tuyên bố chính xác tuyệt đối.
- Người dùng xoay, pan, zoom, chọn cấu kiện, bật/tắt tầng, đo và xuất mô hình được.
- File lỗi, file không hỗ trợ và tác vụ bị hủy có trạng thái rõ ràng.
- Kết quả tác vụ cũ không thay thế bản vẽ mới; sửa tham số và hoàn tác cập nhật đúng mô hình.
- UI hoạt động trên desktop/mobile, không cuộn ngang, canvas resize đúng.
- Kết quả có phong cách mô hình kiến trúc trắng/xám, đường cạnh mảnh và chế độ bán trong suốt như ảnh tham chiếu; các chi tiết phải đối chiếu được với bản vẽ đầu vào.
- Không dùng cube cố định hoặc công trình dựng sẵn làm kết quả nhận dạng.
