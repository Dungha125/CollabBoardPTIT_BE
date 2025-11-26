-- Analytics Schema for CollabBoard
-- Tracking visits, user activities, and statistics

-- 1. Bảng theo dõi visits
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
    INDEX idx_visited_at (visited_at),
    INDEX idx_country (country)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Bảng theo dõi activities của user
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
    INDEX idx_created_at (created_at),
    INDEX idx_activity_type (activity_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Bảng thống kê room (tổng hợp)
CREATE TABLE IF NOT EXISTS room_statistics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    room_id CHAR(36) NOT NULL UNIQUE,
    view_count INT DEFAULT 0,
    message_count INT DEFAULT 0,
    drawing_count INT DEFAULT 0,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    INDEX idx_room (room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. View để lấy analytics summary nhanh
CREATE OR REPLACE VIEW analytics_summary AS
SELECT 
    COUNT(DISTINCT pv.id) AS total_visits,
    COUNT(DISTINCT pv.user_id) AS unique_users,
    COUNT(DISTINCT pv.country) AS total_countries,
    DATE(pv.visited_at) AS visit_date
FROM page_visits pv
GROUP BY DATE(pv.visited_at);

-- 5. View để lấy top countries
CREATE OR REPLACE VIEW top_countries AS
SELECT 
    country,
    country_code,
    COUNT(*) AS visit_count
FROM page_visits
WHERE country != 'Unknown'
GROUP BY country, country_code
ORDER BY visit_count DESC;

-- Insert some initial demo data (optional)
-- Bạn có thể uncomment để test

-- INSERT INTO page_visits (user_id, ip_address, country, country_code, page_url) VALUES
-- (NULL, '127.0.0.1', 'Vietnam', 'VN', '/'),
-- (NULL, '192.168.1.1', 'USA', 'US', '/'),
-- (NULL, '10.0.0.1', 'Japan', 'JP', '/analytics');

