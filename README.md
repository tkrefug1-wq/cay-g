# CAY G

Next.js 16 · TypeScript · PostgreSQL · Prisma 6 · server-side sessions/RBAC.

## Chạy local
1. `npm ci` và `npm run db:generate`.
2. Copy `.env.example` thành `.env`; đặt `DATABASE_URL`, `APP_ORIGIN`, `KEY_ENCRYPTION_SECRET` (64 ký tự hex), `DEMO_PASSWORD` (12+ ký tự). Tạo encryption key bằng `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Dùng PostgreSQL có sẵn; hoặc `npm run db:local` với URL loopback và port riêng (ví dụ 55432). Database local dùng PostgreSQL thật, UTF-8, lưu bền trong `.local-db`.
4. `npm run db:migrate` → `npm run db:seed` → `npm run build` → `npm start`.
5. Mở `APP_ORIGIN` (mặc định `http://localhost:3000`). Demo: `admin@cayg.local`, `ctv@cayg.local`, `con@cayg.local`; mật khẩu bằng `DEMO_PASSWORD`.

## Test
- Đặt `TEST_DATABASE_URL` trỏ đến database riêng có tên kết thúc `_test`. Tests **truncate database test**, không dùng database app.
- `npm test`: integration trên PostgreSQL, tự chạy migrations.
- `npm run build` → `npm test` → `npm run test:e2e`: Chromium, UI thật và HTTP, app test ở port 3001. Cài browser lần đầu: `npx playwright install chromium`.
- `npm run typecheck`; `npm audit`.

## Deploy
Đặt `POSTGRES_PASSWORD` (URL-safe), `APP_ORIGIN=https://...`, `KEY_ENCRYPTION_SECRET`; chạy `docker compose up -d --build`. Dùng reverse proxy HTTPS tới `127.0.0.1:3000`. Migration hoàn tất trước app. Sao lưu PostgreSQL và encryption key; không thay encryption key khi dữ liệu đang dùng.
Tạo admin thật: `docker compose run --rm -e ADMIN_EMAIL=... -e ADMIN_NAME=... -e ADMIN_PASSWORD=... migrate npm run admin:create`. Seed demo chỉ chạy khi chủ động yêu cầu, không chạy tự động trong production.

## Quy ước nghiệp vụ
- Múi giờ `Asia/Ho_Chi_Minh`; tiền cùng đơn vị với số nhập (100 nghĩa là 100, không tự nhân 1.000). Decimal, số nhập tối đa 2 chữ số lẻ; kết quả chia lưu 4 chữ số lẻ.
- Payout = vốn nạp + phần lãi/lỗ được chia + hoa hồng con (nếu có). Lỗ chia theo cùng tỷ lệ. CTV cha chốt sau các con có phát sinh; CLOSED/APPROVED/PAID khóa dữ liệu.
- Data 3 field tạo/reuse master Key, 7 field còn lại để trống; nhập/sửa Key đủ 10 field. STK không được đổi. Password/PIN mã hóa AES-256-GCM; session token chỉ lưu hash.
- Xóa khỏi Hôm nay: hủy ACTIVE, ẩn dòng, giữ DONE và tổng tài chính. Key có mọi loại usage đều archive. Chọn tất cả áp dụng theo bộ lọc, tối đa 5.000 Key/lần; import/start tối đa 500/lần.
