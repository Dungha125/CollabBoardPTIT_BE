// database.js - MySQL connection and queries
const mysql = require('mysql2/promise');
require('dotenv').config();

// Create connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME || 'collabboard_db',
  user: process.env.DB_USER || 'collabboard_user',
  password: process.env.DB_PASSWORD,
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

module.exports = {
  pool,
  userQueries,
  roomQueries,
  collaboratorQueries,
  roomDataQueries,
  // Export query function for custom queries
  query: async (sql, params) => {
    const [rows] = await pool.query(sql, params);
    return rows;
  }
};
