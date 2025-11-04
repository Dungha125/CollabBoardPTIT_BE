# CollabBoard Backend

Backend server cho ứng dụng vẽ cộng tác CollabBoard với Socket.io và Google OAuth.

## Tính năng

- 🔐 **Xác thực Google OAuth 2.0**
- 🎨 **Real-time collaboration** với Socket.io
- 🏠 **Room management** - Tạo và quản lý phòng vẽ
- 📧 **Email invitations** - Mời người dùng qua email
- 👥 **Theo dõi số người trong phòng**
- 🔄 **Đồng bộ drawing state** theo thời gian thực

## Công nghệ sử dụng

- Node.js & Express
- Socket.io (Real-time communication)
- Passport.js (Google OAuth)
- Nodemailer (Email sending)
- Express-session (Session management)

## Cài đặt

1. **Cài đặt dependencies:**
```bash
npm install
```

2. **Cấu hình biến môi trường:**

Copy file `.env.example` thành `.env` và điền thông tin:

```bash
cp .env.example .env
```

### Cấu hình Google OAuth:

1. Truy cập [Google Cloud Console](https://console.cloud.google.com/)
2. Tạo project mới hoặc chọn project có sẵn
3. Bật Google+ API
4. Tạo OAuth 2.0 credentials:
   - Authorized JavaScript origins: `http://localhost:5000`
   - Authorized redirect URIs: `http://localhost:5000/auth/google/callback`
5. Copy Client ID và Client Secret vào file `.env`

### Cấu hình Email (Gmail):

1. Bật xác thực 2 yếu tố cho tài khoản Google
2. Truy cập https://myaccount.google.com/apppasswords
3. Tạo "App Password" mới
4. Copy email và app password vào `.env`:
   - `EMAIL_USER`: địa chỉ Gmail của bạn
   - `EMAIL_PASS`: app password vừa tạo (không phải mật khẩu Gmail thường)

## Chạy server

### Development mode (với nodemon):
```bash
npm run dev
```

### Production mode:
```bash
npm start
```

Server sẽ chạy tại `http://localhost:5000`

## API Endpoints

### Authentication
- `GET /auth/google` - Khởi tạo Google OAuth flow
- `GET /auth/google/callback` - OAuth callback
- `GET /auth/status` - Kiểm tra trạng thái đăng nhập
- `POST /auth/logout` - Đăng xuất
- `GET /api/user/profile` - Lấy thông tin user (yêu cầu auth)

### Room Management
- `POST /api/rooms/create` - Tạo room mới (yêu cầu auth)
- `GET /api/rooms/:roomId` - Lấy thông tin room (yêu cầu auth)
- `POST /api/rooms/invite` - Gửi lời mời qua email (yêu cầu auth)

## Socket.io Events

### Client → Server:
- `join-room` - Join vào một room
  ```javascript
  { roomId: string, user: object }
  ```
- `drawing-update` - Gửi cập nhật vẽ
  ```javascript
  { roomId: string, elements: array, appState: object }
  ```
- `pointer-update` - Gửi vị trí con trỏ
  ```javascript
  { roomId: string, pointer: object, user: object }
  ```

### Server → Client:
- `room-state` - Trạng thái hiện tại của room
  ```javascript
  { elements: array, appState: object }
  ```
- `drawing-update` - Cập nhật vẽ từ người khác
  ```javascript
  { elements: array, appState: object }
  ```
- `user-joined` - Có người join room
  ```javascript
  { userId: string, user: object }
  ```
- `user-left` - Có người rời room
  ```javascript
  { userId: string }
  ```
- `user-count` - Số người trong room
  ```javascript
  number
  ```

## Lưu ý

- Rooms sẽ tự động bị xóa sau 1 giờ không hoạt động
- Session cookie có thời hạn 24 giờ
- Để sử dụng email, cần cấu hình đúng EMAIL_USER và EMAIL_PASS
- Trong production, nên sử dụng HTTPS và cập nhật CORS settings

## Debug

Nếu gặp lỗi kết nối Socket.io:
- Kiểm tra CORS settings trong `server.js`
- Đảm bảo Frontend đang kết nối đúng URL
- Kiểm tra firewall/antivirus không chặn port 5000

Nếu gửi email không thành công:
- Kiểm tra EMAIL_USER và EMAIL_PASS trong `.env`
- Đảm bảo đã tạo App Password (không phải mật khẩu thường)
- Kiểm tra logs trong console để xem lỗi chi tiết
