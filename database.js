// database.js - MySQL connection and queries
const mysql = require('mysql2/promise');
require('dotenv').config();

// Create connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'shuttle.proxy.rlwy.net',
  port: process.env.DB_PORT || 36767,
  database: process.env.DB_NAME || 'railway',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'ihzobdrgUVeWfDqLxdLIEMmOmqwyOTrD',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// Test connection
pool.getConnection()
  .then(connection => {
    console.log('✓ Connected to MySQL database');
    connection.release();
  })
  .catch(err => {
    console.error('✗ MySQL connection error:', err.message);
  });

// User queries
const userQueries = {
  async findOrCreateUser(googleId, email, name, picture) {
    const connection = await pool.getConnection();
    try {
      // Try to find user
      const [users] = await connection.query(
        'SELECT * FROM users WHERE google_id = ?',
        [googleId]
      );

      if (users.length > 0) {
        // Update last login
        await connection.query(
          'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
          [users[0].id]
        );
        return users[0];
      }

      // Create new user
      const [result] = await connection.query(
        `INSERT INTO users (google_id, email, name, picture) 
         VALUES (?, ?, ?, ?)`,
        [googleId, email, name, picture]
      );
      // Get the created user
      const [newUsers] = await connection.query(
        'SELECT * FROM users WHERE id = ?',
        [result.insertId]
      );
      return newUsers[0];
    } finally {
      connection.release();
    }
  },

  async findByGoogleId(googleId) {
    const [users] = await pool.query(
      'SELECT * FROM users WHERE google_id = ?',
      [googleId]
    );
    return users[0];
  },

  async findByEmail(email) {
    const [users] = await pool.query(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );
    return users[0];
  },

  async findById(userId) {
    const [users] = await pool.query(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    );
    return users[0];
  },

  async updateUserName(userId, name) {
    const [result] = await pool.query(
      'UPDATE users SET name = ? WHERE id = ?',
      [name, userId]
    );
    return result;
  }
};

// Room queries
const roomQueries = {
  async createRoom(name, description, ownerId) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Create room (MySQL will auto-generate UUID)
      const [roomResult] = await connection.query(
        `INSERT INTO rooms (name, description, owner_id) 
         VALUES (?, ?, ?)`,
        [name || 'Untitled Room', description || '', ownerId]
      );

      // Get the created room
      const [rooms] = await connection.query(
        'SELECT * FROM rooms WHERE id = (SELECT id FROM rooms WHERE owner_id = ? ORDER BY created_at DESC LIMIT 1)',
        [ownerId]
      );
      
      const room = rooms[0];

      // Create initial room data
      await connection.query(
        `INSERT INTO room_data (room_id, elements, app_state, updated_by) 
         VALUES (?, ?, ?, ?)`,
        [room.id, '[]', '{}', ownerId]
      );

      await connection.commit();
      return room;
    } catch (e) {
      await connection.rollback();
      throw e;
    } finally {
      connection.release();
    }
  },

  async getRoomById(roomId) {
    const [rooms] = await pool.query(
      `SELECT r.*, u.name as owner_name, u.email as owner_email, u.picture as owner_picture
       FROM rooms r
       LEFT JOIN users u ON r.owner_id = u.id
       WHERE r.id = ?`,
      [roomId]
    );
    return rooms[0];
  },

  async getRoomsByOwner(ownerId, limit = 50, offset = 0) {
    const [rooms] = await pool.query(
      `SELECT r.*, 
              (SELECT COUNT(*) FROM room_collaborators WHERE room_id = r.id) as collaborator_count
       FROM rooms r
       WHERE r.owner_id = ? AND r.is_active = TRUE
       ORDER BY r.updated_at DESC
       LIMIT ? OFFSET ?`,
      [ownerId, limit, offset]
    );
    return rooms;
  },

  async getRoomsByCollaborator(userId, limit = 50, offset = 0) {
    const [rooms] = await pool.query(
      `SELECT r.*, u.name as owner_name, u.email as owner_email,
              rc.role as my_role,
              (SELECT COUNT(*) FROM room_collaborators WHERE room_id = r.id) as collaborator_count
       FROM room_collaborators rc
       JOIN rooms r ON rc.room_id = r.id
       JOIN users u ON r.owner_id = u.id
       WHERE rc.user_id = ? AND r.is_active = TRUE
       ORDER BY r.updated_at DESC
       LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );
    return rooms;
  },

  async updateRoom(roomId, updates) {
    const fields = [];
    const values = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.is_active !== undefined) {
      fields.push('is_active = ?');
      values.push(updates.is_active);
    }

    if (fields.length === 0) return null;
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(roomId);

    const query = `UPDATE rooms SET ${fields.join(', ')} WHERE id = ?`;
    await pool.query(query, values);
    
    const [rooms] = await pool.query('SELECT * FROM rooms WHERE id = ?', [roomId]);
    return rooms[0];
  },

  async deleteRoom(roomId) {
    const [result] = await pool.query(
      'DELETE FROM rooms WHERE id = ?',
      [roomId]
    );
    return result.affectedRows > 0;
  },

  async updateLastAccessed(roomId) {
    await pool.query(
      'UPDATE rooms SET last_accessed = CURRENT_TIMESTAMP WHERE id = ?',
      [roomId]
    );
  },

  async isOwner(roomId, userId) {
    const [rows] = await pool.query(
      'SELECT 1 FROM rooms WHERE id = ? AND owner_id = ?',
      [roomId, userId]
    );
    return rows.length > 0;
  },

  async hasAccess(roomId, userId) {
    const [rows] = await pool.query(
      `SELECT 1 FROM rooms WHERE id = ? AND (
        owner_id = ? OR 
        EXISTS (SELECT 1 FROM room_collaborators WHERE room_id = ? AND user_id = ?)
      )`,
      [roomId, userId, roomId, userId]
    );
    return rows.length > 0;
  }
};

// Collaborator queries
const collaboratorQueries = {
  async addCollaborator(roomId, userId, role, invitedBy) {
    const [result] = await pool.query(
      `INSERT INTO room_collaborators (room_id, user_id, role, invited_by, accepted_at) 
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) 
       ON DUPLICATE KEY UPDATE role = ?`,
      [roomId, userId, role || 'editor', invitedBy, role || 'editor']
    );
    
    const [collaborators] = await pool.query(
      'SELECT * FROM room_collaborators WHERE room_id = ? AND user_id = ?',
      [roomId, userId]
    );
    return collaborators[0];
  },

  async removeCollaborator(roomId, userId) {
    const [result] = await pool.query(
      'DELETE FROM room_collaborators WHERE room_id = ? AND user_id = ?',
      [roomId, userId]
    );
    return result.affectedRows > 0;
  },

  async getCollaborators(roomId) {
    const [collaborators] = await pool.query(
      `SELECT rc.*, u.name, u.email, u.picture, 
              inviter.name as invited_by_name
       FROM room_collaborators rc
       JOIN users u ON rc.user_id = u.id
       LEFT JOIN users inviter ON rc.invited_by = inviter.id
       WHERE rc.room_id = ?
       ORDER BY rc.invited_at DESC`,
      [roomId]
    );
    return collaborators;
  },

  async updateCollaboratorRole(roomId, userId, role) {
    const [result] = await pool.query(
      'UPDATE room_collaborators SET role = ? WHERE room_id = ? AND user_id = ?',
      [role, roomId, userId]
    );
    
    const [collaborators] = await pool.query(
      'SELECT * FROM room_collaborators WHERE room_id = ? AND user_id = ?',
      [roomId, userId]
    );
    return collaborators[0];
  }
};

// Room data queries
const roomDataQueries = {
  async saveRoomData(roomId, elements, appState, updatedBy) {
    // UPSERT: Update nếu tồn tại, Insert nếu chưa có
    const [result] = await pool.query(
      `INSERT INTO room_data (room_id, elements, app_state, updated_by, version) 
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE 
         elements = VALUES(elements),
         app_state = VALUES(app_state),
         updated_by = VALUES(updated_by),
         version = version + 1,
         updated_at = CURRENT_TIMESTAMP`,
      [roomId, JSON.stringify(elements), JSON.stringify(appState), updatedBy]
    );
    // Lấy record đã save
    const [data] = await pool.query(
      'SELECT * FROM room_data WHERE room_id = ?',
      [roomId]
    );
    return data[0];
  },

  async getRoomData(roomId) {
    const [data] = await pool.query(
      `SELECT * FROM room_data 
       WHERE room_id = ? 
       ORDER BY version DESC 
       LIMIT 1`,
      [roomId]
    );
    return data[0];
  },

  async getRoomDataHistory(roomId, limit = 10) {
    const [data] = await pool.query(
      `SELECT rd.*, u.name as updated_by_name 
       FROM room_data rd
       LEFT JOIN users u ON rd.updated_by = u.id
       WHERE rd.room_id = ? 
       ORDER BY rd.version DESC 
       LIMIT ?`,
      [roomId, limit]
    );
    return data;
  }
};
// query for chat messages
const chatQueries = {
  // Lưu tin nhắn
  async saveMessage(roomId, senderId, content, googleId, type = 'text') {
    const [result] = await pool.query(
      `INSERT INTO messages (room_id, sender_id, content, type)
       VALUES (?, ?, ?, ?)`,
      [roomId, senderId, content, type]
    );
    // Lấy lại tin nhắn vừa lưu
    const [messages] = await pool.query(
      `SELECT m.*, u.name as sender_name, u.email as sender_email, u.picture as sender_picture
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.id = ?`,
      [result.insertId]
    );
    return messages[0];
  },

  // Lấy tất cả tin nhắn của room (có thể phân trang)
  async getMessagesByRoom(roomId, limit = 100, offset = 0) {
    const [messages] = await pool.query(
      `SELECT m.*, u.name as sender_name, u.email as sender_email, u.picture as sender_picture
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.room_id = ?
       ORDER BY m.created_at ASC
       LIMIT ? OFFSET ?`,
      [roomId, limit, offset]
    );
    return messages;
  },

  // Lấy tin nhắn mới nhất
  async getLatestMessages(roomId, limit = 50) {
    const [messages] = await pool.query(
      `SELECT m.*, u.name as sender_name, u.email as sender_email, u.picture as sender_picture, u.google_id as sender_google_id
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.room_id = ?
       ORDER BY m.created_at DESC
       LIMIT ?`,
      [roomId, limit]
    );
    // Sắp xếp lại theo thứ tự thời gian tăng dần
    return messages.reverse();
  }
};

// Analytics queries
const analyticsQueries = {
  // Track page visit
  async trackVisit(userId, ipAddress, userAgent, pageUrl, country = 'Unknown', countryCode = null, city = null, sessionId = null) {
    try {
      const [result] = await pool.query(
        `INSERT INTO page_visits (user_id, ip_address, user_agent, page_url, country, country_code, city, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, ipAddress, userAgent, pageUrl, country, countryCode, city, sessionId]
      );
      return result.insertId;
    } catch (error) {
      console.error('Error tracking visit:', error);
      return null;
    }
  },

  // Track user activity
  async trackActivity(userId, roomId, activityType, details = null) {
    try {
      const [result] = await pool.query(
        `INSERT INTO user_activities (user_id, room_id, activity_type, details)
         VALUES (?, ?, ?, ?)`,
        [userId, roomId, activityType, JSON.stringify(details)]
      );
      return result.insertId;
    } catch (error) {
      console.error('Error tracking activity:', error);
      return null;
    }
  },

  // Get total visits in time range
  async getTotalVisits(days = 30) {
    try {
      const [rows] = await pool.query(
        `SELECT COUNT(*) AS total_visits
         FROM page_visits
         WHERE visited_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [days]
      );
      return rows[0].total_visits || 0;
    } catch (error) {
      console.error('Error getting total visits:', error);
      return 0;
    }
  },

  // Get unique users in time range
  async getUniqueUsers(days = 30) {
    try {
      const [rows] = await pool.query(
        `SELECT COUNT(DISTINCT user_id) AS unique_users
         FROM page_visits
         WHERE visited_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         AND user_id IS NOT NULL`,
        [days]
      );
      return rows[0].unique_users || 0;
    } catch (error) {
      console.error('Error getting unique users:', error);
      return 0;
    }
  },

  // Get visits by date
  async getVisitsByDate(days = 30) {
    try {
      const [rows] = await pool.query(
        `SELECT 
          DATE_FORMAT(visited_at, '%b %d') AS date,
          COUNT(*) AS visits
         FROM page_visits
         WHERE visited_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY DATE(visited_at)
         ORDER BY visited_at ASC`,
        [days]
      );
      return rows;
    } catch (error) {
      console.error('Error getting visits by date:', error);
      return [];
    }
  },

  // Get visits by country
  async getVisitsByCountry(limit = 20) {
    try {
      const [rows] = await pool.query(
        `SELECT 
          country,
          country_code,
          COUNT(*) AS visits
         FROM page_visits
         WHERE country != 'Unknown'
         GROUP BY country, country_code
         ORDER BY visits DESC
         LIMIT ?`,
        [limit]
      );
      return rows;
    } catch (error) {
      console.error('Error getting visits by country:', error);
      return [];
    }
  },

  // Get recent visits
  async getRecentVisits(limit = 20) {
    try {
      const [rows] = await pool.query(
        `SELECT 
          pv.id,
          pv.country,
          pv.country_code,
          pv.visited_at AS timestamp,
          COALESCE(u.name, 'Anonymous') AS user_name,
          pv.page_url
         FROM page_visits pv
         LEFT JOIN users u ON pv.user_id = u.id
         ORDER BY pv.visited_at DESC
         LIMIT ?`,
        [limit]
      );
      return rows;
    } catch (error) {
      console.error('Error getting recent visits:', error);
      return [];
    }
  },

  // Get countries count
  async getCountriesCount() {
    try {
      const [rows] = await pool.query(
        `SELECT COUNT(DISTINCT country) AS total_countries
         FROM page_visits
         WHERE country != 'Unknown'`
      );
      return rows[0].total_countries || 0;
    } catch (error) {
      console.error('Error getting countries count:', error);
      return 0;
    }
  },

  // Get growth percentage
  async getGrowthPercentage(metric = 'visits', days = 7) {
    try {
      const currentPeriod = await pool.query(
        `SELECT COUNT(*) AS count
         FROM page_visits
         WHERE visited_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [days]
      );
      
      const previousPeriod = await pool.query(
        `SELECT COUNT(*) AS count
         FROM page_visits
         WHERE visited_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         AND visited_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [days * 2, days]
      );
      
      const current = currentPeriod[0][0].count || 0;
      const previous = previousPeriod[0][0].count || 1;
      
      return parseFloat(((current - previous) / previous * 100).toFixed(1));
    } catch (error) {
      console.error('Error getting growth percentage:', error);
      return 0;
    }
  },

  // Get user activities
  async getUserActivities(userId, limit = 10) {
    try {
      const [rows] = await pool.query(
        `SELECT 
          ua.activity_type,
          r.name AS room_name,
          ua.created_at AS timestamp
         FROM user_activities ua
         LEFT JOIN rooms r ON ua.room_id = r.id
         WHERE ua.user_id = ?
         ORDER BY ua.created_at DESC
         LIMIT ?`,
        [userId, limit]
      );
      return rows;
    } catch (error) {
      console.error('Error getting user activities:', error);
      return [];
    }
  },

  // Update room statistics
  async updateRoomStats(roomId, type) {
    try {
      // Ensure room stats entry exists
      await pool.query(
        `INSERT INTO room_statistics (room_id)
         VALUES (?)
         ON DUPLICATE KEY UPDATE room_id = room_id`,
        [roomId]
      );

      // Update the counter
      const field = type === 'view' ? 'view_count' : 
                    type === 'message' ? 'message_count' : 'drawing_count';
      
      await pool.query(
        `UPDATE room_statistics
         SET ${field} = ${field} + 1,
             last_activity = CURRENT_TIMESTAMP
         WHERE room_id = ?`,
        [roomId]
      );
    } catch (error) {
      console.error('Error updating room stats:', error);
    }
  },

  // Get room statistics
  async getRoomStats(roomId) {
    try {
      const [rows] = await pool.query(
        `SELECT * FROM room_statistics WHERE room_id = ?`,
        [roomId]
      );
      return rows[0] || {
        view_count: 0,
        message_count: 0,
        drawing_count: 0
      };
    } catch (error) {
      console.error('Error getting room stats:', error);
      return {
        view_count: 0,
        message_count: 0,
        drawing_count: 0
      };
    }
  }
};

module.exports = {
  pool,
  userQueries,
  roomQueries,
  collaboratorQueries,
  roomDataQueries,
  chatQueries,
  analyticsQueries,
  // Export query function for custom queries
  query: async (sql, params) => {
    const [rows] = await pool.query(sql, params);
    return rows;
  }
};
