# Whiteboard Backend

Backend server cho ứng dụng whiteboard cộng tác (real-time) sử dụng Socket.io, Express và Google OAuth.

## Tính năng

- 🔐 **Xác thực Google OAuth 2.0**
- 🧑‍🤝‍🧑 **Cộng tác thời gian thực** (vẽ, con trỏ, trạng thái bảng)
- 🏠 **Quản lý phòng**: tạo/join/thoát, đếm người tham gia
- 📧 **Mời qua email**: gửi link mời phòng
- ♻️ **Đồng bộ state**: phần tử vẽ, appState, con trỏ
- 🧹 **Dọn tài nguyên**: tự xoá phòng khi không hoạt động

## Công nghệ sử dụng

- Node.js & Express
- Socket.io (Real-time communication)
- Passport.js (Google OAuth)
- Nodemailer hoặc Resend (Email delivery)
- express-session (Session management)
- MySQL 

## Cơ sở dữ liệu
```sql
-- Tạo database (nếu chưa có)
CREATE DATABASE IF NOT EXISTS collabboard_db 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

-- Sử dụng database
USE collabboard_db;

-- Dán câu lệnh tạo các bảng và chạy
CREATE TABLE IF NOT EXISTS rooms (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(255),
    description TEXT,
    owner_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active TINYINT DEFAULT 1,
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    google_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    picture TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_google_id (google_id),
    INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS room_collaborators (
    id INT AUTO_INCREMENT PRIMARY KEY,
    room_id CHAR(36) NOT NULL,
    user_id INT NOT NULL,
    role VARCHAR(50) DEFAULT 'editor', -- 'viewer', 'editor', 'admin'
    invited_by INT,
    invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMP NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (invited_by) REFERENCES users(id),
    UNIQUE KEY unique_room_user (room_id, user_id),
    INDEX idx_room (room_id),
    INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS room_data (
    id INT AUTO_INCREMENT PRIMARY KEY,
    room_id CHAR(36) NOT NULL,
    elements JSON NOT NULL,
    app_state JSON,
    version INT DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by INT,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id),
    INDEX idx_room (room_id),
    INDEX idx_version (room_id, version DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    room_id CHAR(36) NOT NULL,
    sender_id INT NOT NULL,
    content TEXT NOT NULL,
    type ENUM('text','image','file') DEFAULT 'text',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_room (room_id),
    INDEX idx_sender (sender_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW rooms_with_stats AS
SELECT 
    r.id, r.name, r.description, r.owner_id,
    u.name AS owner_name, u.email AS owner_email,
    r.created_at, r.updated_at, r.last_accessed, r.is_active,
    COUNT(DISTINCT rc.user_id) AS collaborator_count
FROM rooms r
LEFT JOIN users u ON r.owner_id = u.id
LEFT JOIN room_collaborators rc ON r.id = rc.room_id
GROUP BY r.id;
```
## Cài đặt

1. **Cài dependencies:**

```bash
npm install
```

2. **Tạo biến môi trường:**

Sao chép `.env.example` thành `.env` và cập nhật giá trị:

```bash
cp .env.example .env
```

Các biến môi trường tối thiểu (tuỳ cách gửi email bạn dùng):

```bash
PORT=5000
SESSION_SECRET=your-strong-secret
CLIENT_URL=http://localhost:3000

GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxx
GOOGLE_CALLBACK_URL=http://localhost:5000/auth/google/callback

# Chọn MỘT trong hai cách gửi email
# Cách 1: Resend (recommended cho production)
RESEND_API_KEY=
EMAIL_FROM=Whiteboard <onboarding@resend.dev>

# Cách 2: Gmail SMTP (local fallback)
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-16-char-app-password

DB_HOST=
DB_PORT=your-port # Thường là 3306
DB_USER=your-usernameSQL # Thường là root
DB_PASSWORD=your-password
DB_NAME=collabboard_db
```

### Cấu hình Google OAuth

1. Mở Google Cloud Console: `https://console.cloud.google.com`
2. Tạo/Chọn Project → OAuth consent screen → Publish (nếu cần)
3. Tạo OAuth 2.0 Credentials (Web application):
   - Authorized JavaScript origins: `http://localhost:5000`
   - Authorized redirect URIs: `http://localhost:5000/auth/google/callback`
4. Điền `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` vào `.env`

### Cấu hình Email

**🏠 Local - Gmail SMTP (fallback):**

1. Bật 2FA cho tài khoản Google
2. Tạo App Password tại `https://myaccount.google.com/apppasswords`
3. Cập nhật `.env`: `EMAIL_USER`, `EMAIL_PASS`

## Chạy server

### Development (nodemon):

```bash
npm run dev
```

### Production:

```bash
npm start
```

Server chạy tại `http://localhost:5000` (cấu hình qua `PORT`).

### Chạy bằng Docker (tuỳ chọn)

```bash
docker build -t whiteboard-backend .
docker run --env-file .env -p 5000:5000 whiteboard-backend
```

## API Endpoints

### Authentication

- `GET /auth/google` — Bắt đầu Google OAuth
- `GET /auth/google/callback` — OAuth callback
- `GET /auth/status` — Kiểm tra trạng thái đăng nhập
- `POST /auth/logout` — Đăng xuất
- `GET /api/user/profile` — Lấy thông tin user (yêu cầu auth)

### Room Management

- `POST /api/rooms/create` — Tạo room mới (yêu cầu auth)
- `GET /api/rooms/:roomId` — Lấy thông tin room (yêu cầu auth)
- `POST /api/rooms/invite` — Gửi lời mời qua email (yêu cầu auth)
### Chat 
- `/api/rooms/:roomId/messages` lấy lịch sử đoạn chat trong phòng


## Socket.io Events

### Client → Server

- `join-room`
  ```javascript
  { roomId: string, user: object }
  ```
- `drawing-update`
  ```javascript
  { roomId: string, elements: array, appState: object }
  ```
- `pointer-update`
  ```javascript
  { roomId: string, pointer: object, user: object }
  ```
- `chat-message`
  ```javascript
  { roomId: string, message: string, user: object }
  ```
- `typing`
  ```javascript
  { roomId: string, user: object, isTyping: boolean}
  ```

### Server → Client

- `room-state`
  ```javascript
  { elements: array, appState: object }
  ```
- `drawing-update`
  ```javascript
  { elements: array, appState: object }
  ```
- `user-joined`
  ```javascript
  { userId: string, user: object }
  ```
- `user-left`
  ```javascript
  {
    userId: string;
  }
  ```
- `user-count`
  ```javascript
  number;
  ```
- `chat-message`
  ```javascript
  { id, text, sender, senderId, timestamp, picture }
  ```
- `user-typing`
  ```javascript
  { userId, userName, isTyping }
  ```
## 📦 CẤU TRÚC
```
Backend/
├── node_modules/           # Thư viện phụ thuộc (tự động tạo bởi npm/yarn)
├── .env                    # Biến môi trường (không commit lên Git)
├── .env.example            # Mẫu file .env để tham khảo
├── .gitignore              # Danh sách file/thư mục bỏ qua khi commit
├── database.js             # Cấu hình kết nối cơ sở dữ liệu
├── package-lock.json       # Khóa phiên bản dependencies (npm)
├── package.json            # Thông tin dự án và dependencies
├── README.md               # Tài liệu hướng dẫn dự án
└── server.js               # File khởi chạy server chính
```
## Lưu ý

- Phòng không hoạt động sẽ tự động dọn sau khoảng thời gian cấu hình (vd. 1 giờ)
- Session cookie mặc định 24 giờ (có thể thay đổi qua cấu hình session)
- Production nên bật HTTPS, cấu hình CORS đúng `CLIENT_URL`, và dùng Resend cho email
- Cân nhắc rate-limit cho các endpoint public/auth

## Debug

Nếu lỗi Socket.io:

- Kiểm tra CORS và URL frontend
- Kiểm tra firewall/antivirus chặn port 5000

Nếu gửi email lỗi:

- Kiểm tra biến môi trường email
- Với Gmail: đảm bảo dùng App Password (không dùng mật khẩu thường)
- Xem log server để biết chi tiết lỗi
