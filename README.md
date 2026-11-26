# Bộ cài Phông Việt Studio cho Windows

Bộ cài dùng NSIS. Ứng dụng nhúng giao diện vào tệp thực thi Go, phục vụ giao diện trên địa chỉ nội bộ và mở trình duyệt mặc định. Máy cài ứng dụng chỉ cần Windows 10/11 x64 và một trình duyệt.

## Biên dịch bằng Linux x86-64

Cần Go 1.27.4, Python 3.9 trở lên và NSIS. Trên hệ Debian hoặc Ubuntu có glibc 2.38 trở lên, có thể lấy NSIS 3.11 đã ghim mã băm qua script đi kèm.

```sh
bash installer/fetch-nsis.sh
bash build-release.sh
```

Dùng biến `GO_BIN` để trỏ tới tệp thực thi Go nếu lệnh `go` không có trong PATH. Các tệp được tạo trong `build/`.

- `PhongVietStudio-Setup-x64.exe` là bộ cài dành cho Windows x64.
- `PhongVietStudio-Windows-x64.zip` chứa bộ cài, hướng dẫn, giấy phép thành phần và mã SHA-256.
- `PhongVietStudio.exe` là ứng dụng được nhúng vào bộ cài.

Trên GitHub, workflow **Build Windows installer** tạo gói ZIP trong **Actions → Artifacts**. Bản dựng mặc định chưa có chữ ký Authenticode.
