-- =====================================================
-- CollabBoard - Full Database Schema
-- Real-time Collaborative Whiteboard Application
-- Nhóm 20 - Lập trình mạng
-- =====================================================

-- =====================================================
-- STEP 1: CREATE DATABASE
-- =====================================================

DROP DATABASE IF EXISTS collabboard_db;
CREATE DATABASE collabboard_db 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

USE collabboard_db;

-- =====================================================
-- STEP 2: CREATE TABLES
-- =====================================================

-- -----------------------------------------------------
-- Table: users
-- Lưu thông tin người dùng (Google OAuth)
-- -----------------------------------------------------
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Bảng người dùng với Google OAuth';

-- -----------------------------------------------------
-- Table: rooms
-- Lưu thông tin các phòng vẽ
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS rooms (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    owner_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active TINYINT DEFAULT 1,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_owner (owner_id),
    INDEX idx_active (is_active),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Bảng phòng vẽ';

-- -----------------------------------------------------
-- Table: room_collaborators
-- Quản lý quyền truy cập phòng
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS room_collaborators (
    id INT AUTO_INCREMENT PRIMARY KEY,
    room_id CHAR(36) NOT NULL,
    user_id INT NOT NULL,
    role VARCHAR(50) DEFAULT 'editor',
    invited_by INT,
    invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMP NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE KEY unique_room_user (room_id, user_id),
    INDEX idx_room (room_id),
    INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Bảng cộng tác viên trong phòng';

-- -----------------------------------------------------
-- Table: room_data
-- Lưu dữ liệu vẽ của phòng (elements & appState)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS room_data (
    id INT AUTO_INCREMENT PRIMARY KEY,
    room_id CHAR(36) NOT NULL,
    elements JSON NOT NULL,
    app_state JSON,
    version INT DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_room (room_id),
    INDEX idx_version (room_id, version DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Bảng lưu dữ liệu vẽ';

-- -----------------------------------------------------
-- Table: messages
-- Lưu tin nhắn chat trong phòng
-- -----------------------------------------------------
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
    INDEX idx_created_at (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Bảng tin nhắn chat';

-- =====================================================
-- ANALYTICS TABLES (NEW)
-- =====================================================

-- -----------------------------------------------------
-- Table: page_visits
-- Theo dõi lượt truy cập website
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS page_visits (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    page_url VARCHAR(255),
    country VARCHAR(100) DEFAULT 'Unknown',
    country_code VARCHAR(10),
    city VARCHAR(100),
    visited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    session_id VARCHAR(255),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user (user_id),
    INDEX idx_visited_at (visited_at DESC),
    INDEX idx_country (country),
    INDEX idx_country_code (country_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Bảng theo dõi lượt truy cập';

-- -----------------------------------------------------
-- Table: user_activities
-- Theo dõi hoạt động của người dùng
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS user_activities (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    room_id CHAR(36),
    activity_type ENUM('room_created', 'room_joined', 'drawing', 'chat', 'login', 'logout') NOT NULL,
    details JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    INDEX idx_user (user_id),
    INDEX idx_room (room_id),
    INDEX idx_created_at (created_at DESC),
    INDEX idx_activity_type (activity_type),
    INDEX idx_user_activity (user_id, activity_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Bảng hoạt động người dùng';

-- -----------------------------------------------------
-- Table: room_statistics
-- Thống kê tổng hợp cho từng phòng
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS room_statistics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    room_id CHAR(36) NOT NULL UNIQUE,
    view_count INT DEFAULT 0,
    message_count INT DEFAULT 0,
    drawing_count INT DEFAULT 0,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    INDEX idx_room (room_id),
    INDEX idx_view_count (view_count DESC),
    INDEX idx_activity (last_activity DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Bảng thống kê phòng';

-- =====================================================
-- STEP 3: CREATE VIEWS
-- =====================================================

-- -----------------------------------------------------
-- View: rooms_with_stats
-- Kết hợp thông tin phòng với số lượng cộng tác viên
-- -----------------------------------------------------
CREATE OR REPLACE VIEW rooms_with_stats AS
SELECT 
    r.id, 
    r.name, 
    r.description, 
    r.owner_id,
    u.name AS owner_name, 
    u.email AS owner_email,
    r.created_at, 
    r.updated_at, 
    r.last_accessed, 
    r.is_active,
    COUNT(DISTINCT rc.user_id) AS collaborator_count,
    COALESCE(rs.view_count, 0) AS view_count,
    COALESCE(rs.message_count, 0) AS message_count,
    COALESCE(rs.drawing_count, 0) AS drawing_count
FROM rooms r
LEFT JOIN users u ON r.owner_id = u.id
LEFT JOIN room_collaborators rc ON r.id = rc.room_id
LEFT JOIN room_statistics rs ON r.id = rs.room_id
GROUP BY r.id, u.name, u.email, rs.view_count, rs.message_count, rs.drawing_count;

-- -----------------------------------------------------
-- View: analytics_summary
-- Tổng hợp analytics theo ngày
-- -----------------------------------------------------
CREATE OR REPLACE VIEW analytics_summary AS
SELECT 
    DATE(visited_at) AS visit_date,
    COUNT(DISTINCT id) AS total_visits,
    COUNT(DISTINCT user_id) AS unique_users,
    COUNT(DISTINCT country) AS total_countries
FROM page_visits
WHERE country != 'Unknown'
GROUP BY DATE(visited_at)
ORDER BY visit_date DESC;

-- -----------------------------------------------------
-- View: top_countries
-- Top quốc gia theo lượt truy cập
-- -----------------------------------------------------
CREATE OR REPLACE VIEW top_countries AS
SELECT 
    country,
    country_code,
    COUNT(*) AS visit_count,
    COUNT(DISTINCT user_id) AS unique_users
FROM page_visits
WHERE country != 'Unknown'
GROUP BY country, country_code
ORDER BY visit_count DESC;

-- -----------------------------------------------------
-- View: user_activity_summary
-- Tổng hợp hoạt động theo user
-- -----------------------------------------------------
CREATE OR REPLACE VIEW user_activity_summary AS
SELECT 
    u.id AS user_id,
    u.name,
    u.email,
    COUNT(CASE WHEN ua.activity_type = 'room_created' THEN 1 END) AS rooms_created,
    COUNT(CASE WHEN ua.activity_type = 'room_joined' THEN 1 END) AS rooms_joined,
    COUNT(CASE WHEN ua.activity_type = 'drawing' THEN 1 END) AS drawings_count,
    COUNT(CASE WHEN ua.activity_type = 'chat' THEN 1 END) AS messages_count,
    MAX(ua.created_at) AS last_activity
FROM users u
LEFT JOIN user_activities ua ON u.id = ua.user_id
GROUP BY u.id, u.name, u.email;

-- -----------------------------------------------------
-- View: active_rooms
-- Phòng đang hoạt động với thống kê
-- -----------------------------------------------------
CREATE OR REPLACE VIEW active_rooms AS
SELECT 
    r.id,
    r.name,
    r.owner_id,
    u.name AS owner_name,
    r.created_at,
    COALESCE(rs.view_count, 0) AS view_count,
    COALESCE(rs.message_count, 0) AS message_count,
    COALESCE(rs.drawing_count, 0) AS drawing_count,
    (COALESCE(rs.view_count, 0) + COALESCE(rs.message_count, 0) + COALESCE(rs.drawing_count, 0)) AS total_activity,
    COUNT(DISTINCT rc.user_id) AS collaborator_count
FROM rooms r
JOIN users u ON r.owner_id = u.id
LEFT JOIN room_statistics rs ON r.id = rs.room_id
LEFT JOIN room_collaborators rc ON r.id = rc.room_id
WHERE r.is_active = 1
GROUP BY r.id, r.name, r.owner_id, u.name, r.created_at, rs.view_count, rs.message_count, rs.drawing_count
ORDER BY total_activity DESC;

-- =====================================================
-- STEP 4: CREATE STORED PROCEDURES
-- =====================================================

-- -----------------------------------------------------
-- Procedure: sp_get_room_full_info
-- Lấy thông tin đầy đủ của một phòng
-- -----------------------------------------------------
DELIMITER //

CREATE PROCEDURE sp_get_room_full_info(IN p_room_id CHAR(36))
BEGIN
    SELECT 
        r.*,
        u.name AS owner_name,
        u.email AS owner_email,
        COALESCE(rs.view_count, 0) AS view_count,
        COALESCE(rs.message_count, 0) AS message_count,
        COALESCE(rs.drawing_count, 0) AS drawing_count,
        COUNT(DISTINCT rc.user_id) AS collaborator_count
    FROM rooms r
    JOIN users u ON r.owner_id = u.id
    LEFT JOIN room_statistics rs ON r.id = rs.room_id
    LEFT JOIN room_collaborators rc ON r.id = rc.room_id
    WHERE r.id = p_room_id
    GROUP BY r.id, u.name, u.email, rs.view_count, rs.message_count, rs.drawing_count;
END//

-- -----------------------------------------------------
-- Procedure: sp_get_user_statistics
-- Lấy thống kê của một user
-- -----------------------------------------------------
CREATE PROCEDURE sp_get_user_statistics(IN p_user_id INT)
BEGIN
    SELECT 
        u.id,
        u.name,
        u.email,
        COUNT(DISTINCT r.id) AS rooms_owned,
        COUNT(DISTINCT rc.room_id) AS rooms_collaborated,
        COUNT(DISTINCT ua.id) AS total_activities,
        SUM(CASE WHEN ua.activity_type = 'drawing' THEN 1 ELSE 0 END) AS drawing_count,
        SUM(CASE WHEN ua.activity_type = 'chat' THEN 1 ELSE 0 END) AS message_count,
        MAX(ua.created_at) AS last_activity
    FROM users u
    LEFT JOIN rooms r ON u.id = r.owner_id
    LEFT JOIN room_collaborators rc ON u.id = rc.user_id
    LEFT JOIN user_activities ua ON u.id = ua.user_id
    WHERE u.id = p_user_id
    GROUP BY u.id, u.name, u.email;
END//

-- -----------------------------------------------------
-- Procedure: sp_cleanup_old_visits
-- Xóa visits cũ hơn X ngày
-- -----------------------------------------------------
CREATE PROCEDURE sp_cleanup_old_visits(IN p_days INT)
BEGIN
    DELETE FROM page_visits 
    WHERE visited_at < DATE_SUB(NOW(), INTERVAL p_days DAY);
    
    SELECT ROW_COUNT() AS deleted_rows;
END//

DELIMITER ;

-- =====================================================
-- STEP 5: CREATE TRIGGERS
-- =====================================================

-- -----------------------------------------------------
-- Trigger: after_room_insert
-- Tạo entry trong room_statistics khi tạo phòng mới
-- -----------------------------------------------------
DELIMITER //

CREATE TRIGGER after_room_insert
AFTER INSERT ON rooms
FOR EACH ROW
BEGIN
    INSERT INTO room_statistics (room_id, view_count, message_count, drawing_count)
    VALUES (NEW.id, 0, 0, 0);
END//

-- -----------------------------------------------------
-- Trigger: after_message_insert
-- Tăng message_count khi có tin nhắn mới
-- -----------------------------------------------------
CREATE TRIGGER after_message_insert
AFTER INSERT ON messages
FOR EACH ROW
BEGIN
    INSERT INTO room_statistics (room_id, message_count)
    VALUES (NEW.room_id, 1)
    ON DUPLICATE KEY UPDATE 
        message_count = message_count + 1,
        last_activity = CURRENT_TIMESTAMP;
END//

DELIMITER ;

-- =====================================================
-- STEP 6: INSERT DEMO DATA (OPTIONAL)
-- =====================================================

-- Uncomment để insert demo data

-- Demo Users
/*
INSERT INTO users (google_id, email, name, picture) VALUES
('google_id_1', 'user1@gmail.com', 'Nguyễn Văn A', 'https://example.com/avatar1.jpg'),
('google_id_2', 'user2@gmail.com', 'Trần Thị B', 'https://example.com/avatar2.jpg'),
('google_id_3', 'user3@gmail.com', 'Lê Văn C', 'https://example.com/avatar3.jpg');
*/

-- Demo Rooms
/*
INSERT INTO rooms (id, name, description, owner_id) VALUES
(UUID(), 'Phòng Brainstorming', 'Phòng họp nhóm dự án', 1),
(UUID(), 'Phòng Design', 'Thiết kế UI/UX', 2),
(UUID(), 'Phòng Planning', 'Lập kế hoạch sprint', 1);
*/

-- Demo Page Visits
/*
INSERT INTO page_visits (user_id, ip_address, country, country_code, page_url, visited_at) VALUES
(1, '192.168.1.1', 'Vietnam', 'VN', '/', DATE_SUB(NOW(), INTERVAL 1 DAY)),
(2, '192.168.1.2', 'USA', 'US', '/analytics', DATE_SUB(NOW(), INTERVAL 2 DAY)),
(3, '192.168.1.3', 'Japan', 'JP', '/rooms', DATE_SUB(NOW(), INTERVAL 3 DAY)),
(1, '192.168.1.4', 'Vietnam', 'VN', '/', DATE_SUB(NOW(), INTERVAL 4 DAY)),
(NULL, '192.168.1.5', 'Korea', 'KR', '/', DATE_SUB(NOW(), INTERVAL 5 DAY)),
(NULL, '192.168.1.6', 'Singapore', 'SG', '/analytics', DATE_SUB(NOW(), INTERVAL 6 DAY)),
(2, '192.168.1.7', 'Thailand', 'TH', '/rooms', DATE_SUB(NOW(), INTERVAL 7 DAY));
*/

-- =====================================================
-- STEP 7: GRANT PERMISSIONS
-- =====================================================

-- Tạo user cho application (Uncomment và thay password)
/*
CREATE USER IF NOT EXISTS 'collabboard_user'@'localhost' IDENTIFIED BY 'your_secure_password';
GRANT ALL PRIVILEGES ON collabboard_db.* TO 'collabboard_user'@'localhost';
FLUSH PRIVILEGES;
*/

-- =====================================================
-- STEP 8: VERIFICATION QUERIES
-- =====================================================

-- Kiểm tra các bảng đã tạo
SELECT 'Checking tables...' AS status;
SHOW TABLES;

-- Kiểm tra views
SELECT 'Checking views...' AS status;
SHOW FULL TABLES WHERE TABLE_TYPE = 'VIEW';

-- Kiểm tra stored procedures
SELECT 'Checking procedures...' AS status;
SHOW PROCEDURE STATUS WHERE Db = 'collabboard_db';

-- Kiểm tra triggers
SELECT 'Checking triggers...' AS status;
SHOW TRIGGERS;

-- Thống kê bảng
SELECT 
    TABLE_NAME,
    TABLE_ROWS,
    ROUND(DATA_LENGTH / 1024 / 1024, 2) AS 'Data Size (MB)',
    ROUND(INDEX_LENGTH / 1024 / 1024, 2) AS 'Index Size (MB)'
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'collabboard_db'
ORDER BY DATA_LENGTH DESC;

-- =====================================================
-- STEP 9: USEFUL MAINTENANCE QUERIES
-- =====================================================

-- Xem tất cả indexes
/*
SELECT 
    TABLE_NAME,
    INDEX_NAME,
    GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS COLUMNS
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'collabboard_db'
GROUP BY TABLE_NAME, INDEX_NAME;
*/

-- Phân tích performance
/*
SELECT 
    TABLE_NAME,
    ROUND(((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024), 2) AS 'Size (MB)',
    TABLE_ROWS
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'collabboard_db'
ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC;
*/

-- =====================================================
-- END OF SCHEMA
-- =====================================================

SELECT '✅ Database schema created successfully!' AS status;
SELECT 'Database: collabboard_db' AS info;
SELECT 'Total tables: 8' AS info;
SELECT 'Total views: 5' AS info;
SELECT 'Total procedures: 3' AS info;
SELECT 'Total triggers: 2' AS info;
SELECT '🚀 Ready to use!' AS status;

