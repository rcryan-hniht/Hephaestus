# Deploy backend bằng Docker

Chạy từ thư mục gốc repo:

```sh
docker build -t hephaestus-api ./backend
docker run --rm -p 8000:8000 hephaestus-api
```

Kiểm tra API tại `http://localhost:8000/health`.
Container nhận biến `PORT` (mặc định `8000`); khi đổi cổng, cập nhật
mapping tương ứng, ví dụ `-e PORT=9000 -p 9000:9000`.

Trên Render, chọn runtime **Docker**, Root Directory **backend**,
Dockerfile Path **./Dockerfile** và Health Check Path **/health**.
Giữ Docker Command trống để dùng `start.sh` trong image.
`render.yaml` hiện tại vẫn dùng runtime Python; hướng dẫn này áp dụng
khi tạo hoặc cấu hình service Docker trên dashboard.

Frontend tiếp tục deploy riêng trên Vercel.
