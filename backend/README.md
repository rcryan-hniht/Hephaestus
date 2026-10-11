# Chạy frontend và backend

Chạy từ thư mục gốc repo:

```sh
./start.sh
```

Cần Bash, Bun và uv. Script cài dependency theo lockfile, build frontend,
rồi chạy frontend tại `http://localhost:3000` và API tại
`http://localhost:8000/health`. Backend dùng virtualenv qua `uv run`.
Nhấn Ctrl+C để dừng cả hai.

```sh
docker build -t hephaestus .
docker run --rm -p 3000:3000 -p 8000:8000 hephaestus
```

`PORT` đặt cổng frontend (mặc định `3000`); `BACKEND_PORT` đặt cổng API
(mặc định `8000`). Khi đổi cổng, cập nhật Docker mapping tương ứng.

Image chạy hai cổng riêng. Hosting chỉ công khai một cổng cần reverse proxy
để truy cập cả frontend và API trên cùng domain.
`render.yaml` vẫn giữ cấu hình backend Python riêng hiện có.
