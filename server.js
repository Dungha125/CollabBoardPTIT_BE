// server.js
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const nodemailer = require("nodemailer");
require("dotenv").config();
const brevo = require("@getbrevo/brevo");
const {
  userQueries,
  roomQueries,
  collaboratorQueries,
  roomDataQueries,
  chatQueries,
  analyticsQueries,
} = require("./database");

const app = express();
const server = http.createServer(app);

// Tạo transporter 1 lần duy nhất (reuse cho tất cả requests)
const emailTransporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  pool: true, // Sử dụng connection pooling
  maxConnections: 5,
  maxMessages: 100,
});

const io = new Server(server, {
  cors: {
    origin: ["https://colabo.dhatech.pro"],
    credentials: true,
    methods: ["GET", "POST"],
  },
});

app.use(
  cors({
    origin: ["https://colabo.dhatech.pro"],
    credentials: true,
  })
);

app.use(express.json());

// Middleware to track page visits
app.use(async (req, res, next) => {
  try {
    // Only track GET requests to main pages
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      const userId = req.user?.dbId || null;
      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get('user-agent');
      const pageUrl = req.path;
      
      // Try to get country from IP (simplified - in production use GeoIP service)
      let country = 'Unknown';
      let countryCode = null;
      
      // Simple IP-based country detection (placeholder)
      if (ipAddress && ipAddress.includes('127.0.0.1')) {
        country = 'Vietnam';
        countryCode = 'VN';
      }
      
      // Track visit asynchronously (don't wait)
      analyticsQueries.trackVisit(userId, ipAddress, userAgent, pageUrl, country, countryCode)
        .catch(err => console.error('Error tracking visit:', err));
    }
  } catch (error) {
    // Don't block request if tracking fails
    console.error('Visit tracking error:', error);
  }
  next();
});

app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key-change-this",
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      sameSite: "none",
      secure: true,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || "/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Find or create user in database
        const dbUser = await userQueries.findOrCreateUser(
          profile.id,
          profile.emails[0].value,
          profile.displayName,
          profile.photos[0].value
        );

        const user = {
          id: profile.id,
          dbId: dbUser.id,
          name: profile.displayName,
          email: profile.emails[0].value,
          picture: profile.photos[0].value,
        };
        return done(null, user);
      } catch (error) {
        return done(error, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: "Unauthorized" });
};

app.get("/", (req, res) => {
  res.json({ message: "CollabBoard API Server" });
});

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);

app.get(
  "/auth/google/callback",
  passport.authenticate("google", {
    failureRedirect: "https://colabo.dhatech.pro",
  }),
  (req, res) => {
    console.log("✓ User logged in:", req.user?.email);
    res.redirect("https://colabo.dhatech.pro");
  }
);

app.get("/auth/status", (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      authenticated: true,
      user: req.user,
    });
  } else {
    res.json({
      authenticated: false,
    });
  }
});

app.post("/auth/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: "Logout failed" });
    }
    req.session.destroy();
    res.json({ message: "Logged out successfully" });
  });
});

app.get("/api/user/profile", isAuthenticated, (req, res) => {
  res.json({ user: req.user });
});

// Room management
const rooms = new Map(); // roomId -> { users: Set, elements: [], appState: {} }
const userRoomCreationTimestamps = new Map(); // userId -> timestamp (rate limiting)

// Create a new room
app.post("/api/rooms/create", isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.dbId;

    // Rate limiting: Prevent user from creating multiple rooms too quickly
    const lastCreation = userRoomCreationTimestamps.get(userId) || 0;
    const now = Date.now();
    const timeSinceLastCreation = now - lastCreation;

    if (timeSinceLastCreation < 2000) {
      // 2 seconds cooldown
      console.log(
        `⚠️  User ${req.user.email} trying to create room too quickly. Blocked.`
      );
      return res.status(429).json({
        error: "Please wait before creating another room",
        retryAfter: Math.ceil((2000 - timeSinceLastCreation) / 1000),
      });
    }

    // Update timestamp
    userRoomCreationTimestamps.set(userId, now);

    const { name, description } = req.body;

    console.log(`Creating room for user ${req.user.email}...`);

    // Create room in database
    const dbRoom = await roomQueries.createRoom(
      name || "Untitled Room",
      description || "",
      userId
    );

    console.log(`Room created: ${dbRoom.id} by ${req.user.email}`);

    // Track room creation activity
    analyticsQueries.trackActivity(userId, dbRoom.id, 'room_created', { name })
      .catch(err => console.error('Error tracking room creation:', err));

    // Also keep in memory for real-time collaboration
    rooms.set(dbRoom.id, {
      users: new Set(),
      elements: [],
      appState: {},
      userIdMap: {},
      createdBy: req.user.email,
      createdAt: new Date(),
    });

    res.json({
      roomId: dbRoom.id,
      room: dbRoom,
      shareUrl: `https://colabo.dhatech.proroom/${dbRoom.id}`,
    });
  } catch (error) {
    console.error("Error creating room:", error);
    res.status(500).json({ error: "Failed to create room" });
  }
});

// Get room info
app.get("/api/rooms/:roomId", isAuthenticated, async (req, res) => {
  try {
    const { roomId } = req.params;

    // Get from database
    const dbRoom = await roomQueries.getRoomById(roomId);

    if (!dbRoom) {
      return res.status(404).json({ error: "Room not found" });
    }

    // Get in-memory room for active user count
    const memRoom = rooms.get(roomId);

    // Get collaborators
    const collaborators = await collaboratorQueries.getCollaborators(roomId);

    res.json({
      ...dbRoom,
      userCount: memRoom ? memRoom.users.size : 0,
      collaborators,
      isOwner: dbRoom.owner_id === req.user.dbId,
    });
  } catch (error) {
    console.error("Error getting room:", error);
    res.status(500).json({ error: "Failed to get room" });
  }
});

// Get all rooms (owned + collaborated)
app.get("/api/rooms", isAuthenticated, async (req, res) => {
  try {
    const ownedRooms = await roomQueries.getRoomsByOwner(req.user.dbId);
    const collaboratedRooms = await roomQueries.getRoomsByCollaborator(
      req.user.dbId
    );

    // Add room statistics to each room
    const ownedWithStats = await Promise.all(
      ownedRooms.map(async (room) => {
        const stats = await analyticsQueries.getRoomStats(room.id);
        return {
          ...room,
          view_count: stats.view_count || 0,
          message_count: stats.message_count || 0,
          drawing_count: stats.drawing_count || 0
        };
      })
    );

    const collaboratedWithStats = await Promise.all(
      collaboratedRooms.map(async (room) => {
        const stats = await analyticsQueries.getRoomStats(room.id);
        return {
          ...room,
          view_count: stats.view_count || 0,
          message_count: stats.message_count || 0,
          drawing_count: stats.drawing_count || 0
        };
      })
    );

    res.json({
      owned: ownedWithStats,
      collaborated: collaboratedWithStats,
    });
  } catch (error) {
    console.error("Error getting rooms:", error);
    res.status(500).json({ error: "Failed to get rooms" });
  }
});

// Update room details
app.put("/api/rooms/:roomId", isAuthenticated, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { name, description } = req.body;

    // Check if user is owner
    const isOwner = await roomQueries.isOwner(roomId, req.user.dbId);
    if (!isOwner) {
      return res
        .status(403)
        .json({ error: "Only room owner can update room details" });
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;

    const updatedRoom = await roomQueries.updateRoom(roomId, updates);
    res.json(updatedRoom);
  } catch (error) {
    console.error("Error updating room:", error);
    res.status(500).json({ error: "Failed to update room" });
  }
});

// Delete room
app.delete("/api/rooms/:roomId", isAuthenticated, async (req, res) => {
  try {
    const { roomId } = req.params;

    // Check if user is owner
    const isOwner = await roomQueries.isOwner(roomId, req.user.dbId);
    if (!isOwner) {
      return res.status(403).json({ error: "Only room owner can delete room" });
    }

    await roomQueries.deleteRoom(roomId);

    // Remove from memory
    rooms.delete(roomId);

    res.json({ message: "Room deleted successfully" });
  } catch (error) {
    console.error("Error deleting room:", error);
    res.status(500).json({ error: "Failed to delete room" });
  }
});

// Add collaborator to room
app.post(
  "/api/rooms/:roomId/collaborators",
  isAuthenticated,
  async (req, res) => {
    try {
      const { roomId } = req.params;
      const { email, role } = req.body;

      // Check if user is owner
      const isOwner = await roomQueries.isOwner(roomId, req.user.dbId);
      if (!isOwner) {
        return res
          .status(403)
          .json({ error: "Only room owner can add collaborators" });
      }

      // Find user by email
      const collaboratorUser = await userQueries.findByEmail(email);
      if (!collaboratorUser) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check if already owner
      const room = await roomQueries.getRoomById(roomId);
      if (room.owner_id === collaboratorUser.id) {
        return res.status(400).json({ error: "User is already the owner" });
      }

      const collaborator = await collaboratorQueries.addCollaborator(
        roomId,
        collaboratorUser.id,
        role || "editor",
        req.user.dbId
      );

      res.json(collaborator);
    } catch (error) {
      console.error("Error adding collaborator:", error);
      res.status(500).json({ error: "Failed to add collaborator" });
    }
  }
);

// Remove collaborator from room
app.delete(
  "/api/rooms/:roomId/collaborators/:userId",
  isAuthenticated,
  async (req, res) => {
    try {
      const { roomId, userId } = req.params;

      // Check if user is owner
      const isOwner = await roomQueries.isOwner(roomId, req.user.dbId);
      if (!isOwner) {
        return res
          .status(403)
          .json({ error: "Only room owner can remove collaborators" });
      }

      await collaboratorQueries.removeCollaborator(roomId, parseInt(userId));
      res.json({ message: "Collaborator removed successfully" });
    } catch (error) {
      console.error("Error removing collaborator:", error);
      res.status(500).json({ error: "Failed to remove collaborator" });
    }
  }
);

// Update collaborator role
app.put(
  "/api/rooms/:roomId/collaborators/:userId",
  isAuthenticated,
  async (req, res) => {
    try {
      const { roomId, userId } = req.params;
      const { role } = req.body;

      // Check if user is owner
      const isOwner = await roomQueries.isOwner(roomId, req.user.dbId);
      if (!isOwner) {
        return res
          .status(403)
          .json({ error: "Only room owner can update collaborator roles" });
      }

      const updatedCollaborator =
        await collaboratorQueries.updateCollaboratorRole(
          roomId,
          parseInt(userId),
          role
        );
      res.json(updatedCollaborator);
    } catch (error) {
      console.error("Error updating collaborator:", error);
      res.status(500).json({ error: "Failed to update collaborator" });
    }
  }
);

// Get room drawing data (for verification)
app.get("/api/rooms/:roomId/data", isAuthenticated, async (req, res) => {
  try {
    const { roomId } = req.params;

    // Check if user has access
    const hasAccess = await roomQueries.hasAccess(roomId, req.user.dbId);
    if (!hasAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const roomData = await roomDataQueries.getRoomData(roomId);
    if (!roomData) {
      return res.json({
        roomId,
        hasData: false,
        message: "No drawing data saved yet",
      });
    }

    const elements = JSON.parse(roomData.elements || "[]");
    const appState = JSON.parse(roomData.app_state || "{}");

    res.json({
      roomId,
      hasData: true,
      version: roomData.version,
      elementCount: elements.length,
      lastUpdate: roomData.updated_at,
      elements: elements,
      appState: appState,
    });
  } catch (error) {
    console.error("Error getting room data:", error);
    res.status(500).json({ error: "Failed to get room data" });
  }
});

app.post("/api/rooms/invite", isAuthenticated, async (req, res) => {
  const { roomId, emails } = req.body;

  if (!roomId || !emails || !Array.isArray(emails)) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const room = await roomQueries.getRoomById(roomId);
  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }

  const shareUrl = `https://colabo.dhatech.proroom/${roomId}`;

  res.json({ success: true, message: "Đang gửi lời mời..." });

  let apiInstance = new brevo.TransactionalEmailsApi();
  apiInstance.setApiKey(
    brevo.TransactionalEmailsApiApiKeys.apiKey,
    process.env.BREVO_API_KEY
  );

  const emailPromises = emails.map((email) => {
    let sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.subject = `${req.user.name} mời bạn vẽ cùng trên CollabBoard`;
    sendSmtpEmail.htmlContent = `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2 style="color: #4285f4;">Lời mời tham gia bảng vẽ!</h2>
        <p><strong>${req.user.name}</strong> mời bạn tham gia.</p>
        <p><a href="${shareUrl}" style="padding: 12px 25px; background-color: #4285f4; color: white; text-decoration: none; border-radius: 6px;">THAM GIA NGAY</a></p>
      </div>
    `;
    sendSmtpEmail.sender = {
      name: "CollabBoard",
      email: process.env.BREVO_SENDER_EMAIL,
    };
    sendSmtpEmail.to = [{ email: email }];

    return apiInstance.sendTransacEmail(sendSmtpEmail);
  });

  Promise.all(emailPromises)
    .then(() => console.log(`✓ Sent ${emails.length} invitations`))
    .catch((error) => console.error("Email error:", error));
});
// Get chat history for a room
  app.get("/api/rooms/:roomId/messages", isAuthenticated, async (req, res) => {
  try {
    const { roomId } = req.params;
    const limit = parseInt(req.query.limit) || 100;

    // Kiểm tra quyền truy cập phòng
    const hasAccess = await roomQueries.hasAccess(roomId, req.user.dbId);
    if (!hasAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const messages = await chatQueries.getLatestMessages(roomId, limit);
    res.json(messages);
  } catch (error) {
    console.error("Error fetching chat history:", error);
    res.status(500).json({ error: "Failed to load messages" });
  }
});

// ==================== ANALYTICS & STATISTICS ENDPOINTS ====================

// Get user statistics
app.get("/api/user/stats", isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.dbId;
    
    // Get rooms created by user
    const ownedRooms = await roomQueries.getRoomsByOwner(userId);
    
    // Get rooms user has collaborated on
    const collaboratedRooms = await collaboratorQueries.getRoomsByCollaborator(userId);
    
    // Get total drawings (estimate from room_data)
    const totalDrawings = ownedRooms.length + collaboratedRooms.length;
    
    res.json({
      roomsCreated: ownedRooms.length,
      roomsJoined: collaboratedRooms.length,
      totalDrawings: totalDrawings,
      lastActive: new Date()
    });
  } catch (error) {
    console.error("Error fetching user stats:", error);
    res.status(500).json({ error: "Failed to fetch user stats" });
  }
});

// Get user activity
app.get("/api/user/activity", isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.dbId;
    
    // Get recent rooms accessed
    const ownedRooms = await roomQueries.getRoomsByOwner(userId);
    const collaboratedRooms = await collaboratorQueries.getRoomsByCollaborator(userId);
    
    const activities = [];
    
    // Add created rooms as activities
    ownedRooms.slice(0, 5).forEach(room => {
      activities.push({
        type: 'created',
        roomName: room.name,
        timestamp: room.created_at
      });
    });
    
    // Add joined rooms as activities
    collaboratedRooms.slice(0, 5).forEach(room => {
      activities.push({
        type: 'joined',
        roomName: room.name,
        timestamp: room.invited_at || room.created_at
      });
    });
    
    // Sort by timestamp
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    res.json({ activities: activities.slice(0, 10) });
  } catch (error) {
    console.error("Error fetching user activity:", error);
    res.status(500).json({ error: "Failed to fetch user activity" });
  }
});

// Get room statistics (requires authentication) - REAL DATA
app.get("/api/rooms/stats", isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.dbId;
    
    // Get all rooms for this user
    const ownedRooms = await roomQueries.getRoomsByOwner(userId);
    const collaboratedRooms = await collaboratorQueries.getRoomsByCollaborator(userId);
    
    let totalCollaborators = 0;
    let totalMessages = 0;
    let totalDrawings = 0;
    
    // Get real statistics from room_statistics table
    for (const room of ownedRooms) {
      const collaborators = await collaboratorQueries.getCollaboratorsByRoom(room.id);
      totalCollaborators += collaborators.length;
      
      // Get real stats from analytics
      const stats = await analyticsQueries.getRoomStats(room.id);
      totalMessages += stats.message_count || 0;
      totalDrawings += stats.drawing_count || 0;
    }
    
    res.json({
      totalRooms: ownedRooms.length + collaboratedRooms.length,
      totalCollaborators,
      totalDrawings,
      totalMessages
    });
  } catch (error) {
    console.error("Error fetching room stats:", error);
    res.status(500).json({ error: "Failed to fetch room stats" });
  }
});

// Helper function to get country flag
function getCountryFlag(countryCode) {
  const flags = {
    'VN': '🇻🇳', 'US': '🇺🇸', 'JP': '🇯🇵', 'KR': '🇰🇷', 
    'SG': '🇸🇬', 'TH': '🇹🇭', 'CN': '🇨🇳', 'IN': '🇮🇳',
    'GB': '🇬🇧', 'FR': '🇫🇷', 'DE': '🇩🇪', 'AU': '🇦🇺',
    'CA': '🇨🇦', 'BR': '🇧🇷', 'MX': '🇲🇽', 'ES': '🇪🇸',
    'IT': '🇮🇹', 'RU': '🇷🇺', 'PH': '🇵🇭', 'ID': '🇮🇩',
    'MY': '🇲🇾', 'TW': '🇹🇼', 'HK': '🇭🇰', 'NL': '🇳🇱',
    'SE': '🇸🇪', 'NO': '🇳🇴', 'DK': '🇩🇰', 'FI': '🇫🇮',
    'PL': '🇵🇱', 'CZ': '🇨🇿', 'AT': '🇦🇹', 'CH': '🇨🇭',
    'BE': '🇧🇪', 'PT': '🇵🇹', 'GR': '🇬🇷', 'TR': '🇹🇷',
    'ZA': '🇿🇦', 'EG': '🇪🇬', 'NG': '🇳🇬', 'KE': '🇰🇪',
    'AR': '🇦🇷', 'CL': '🇨🇱', 'CO': '🇨🇴', 'PE': '🇵🇪',
    'NZ': '🇳🇿', 'PK': '🇵🇰', 'BD': '🇧🇩', 'LK': '🇱🇰',
    'Unknown': '🌍'
  };
  return flags[countryCode] || '🌍';
}

// Analytics Dashboard - Get analytics data (REAL DATA)
app.get("/api/analytics/dashboard", isAuthenticated, async (req, res) => {
  try {
    const timeRange = req.query.range || '7days';
    const days = timeRange === '7days' ? 7 : timeRange === '30days' ? 30 : 365;
    
    // Get real data from database
    const [
      totalVisits,
      uniqueUsers,
      countriesCount,
      visitsByDate,
      visitsByCountry,
      recentVisits,
      visitsGrowth,
      usersGrowth
    ] = await Promise.all([
      analyticsQueries.getTotalVisits(days),
      analyticsQueries.getUniqueUsers(days),
      analyticsQueries.getCountriesCount(),
      analyticsQueries.getVisitsByDate(days),
      analyticsQueries.getVisitsByCountry(20),
      analyticsQueries.getRecentVisits(15),
      analyticsQueries.getGrowthPercentage('visits', days),
      analyticsQueries.getGrowthPercentage('users', days)
    ]);

    // Add country flags
    const visitsByCountryWithFlags = visitsByCountry.map(v => ({
      country: v.country,
      visits: v.visits,
      countryFlag: getCountryFlag(v.country_code)
    }));

    const recentVisitsWithFlags = recentVisits.map(v => ({
      country: v.country,
      countryFlag: getCountryFlag(v.country_code),
      timestamp: v.timestamp,
      userName: v.user_name,
      pageUrl: v.page_url
    }));

    // Get total activities
    const totalActivity = totalVisits + uniqueUsers * 5; // Simple calculation

    res.json({
      totalVisits,
      uniqueUsers,
      countries: visitsByCountry.map(v => v.country),
      visitsByDate,
      visitsByCountry: visitsByCountryWithFlags,
      recentVisits: recentVisitsWithFlags,
      growth: { 
        visits: visitsGrowth, 
        users: usersGrowth 
      },
      totalActivity
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// Public stats (no auth required) - REAL DATA
app.get("/api/analytics/public-stats", async (req, res) => {
  try {
    const [totalVisits, uniqueUsers, countriesCount] = await Promise.all([
      analyticsQueries.getTotalVisits(365), // Last year
      analyticsQueries.getUniqueUsers(365),
      analyticsQueries.getCountriesCount()
    ]);

    res.json({
      visits: totalVisits,
      users: uniqueUsers,
      countries: countriesCount
    });
  } catch (error) {
    console.error("Error fetching public stats:", error);
    res.status(500).json({ error: "Failed to fetch public stats" });
  }
});

// Update user profile
app.put("/api/user/profile", isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.dbId;
    const { name } = req.body;
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: "Name is required" });
    }
    
    // Update user name in database
    await userQueries.updateUserName(userId, name.trim());
    
    // Update session user
    req.user.name = name.trim();
    
    res.json({ success: true, message: "Profile updated successfully" });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log("✓ Socket connected:", socket.id);
 
  // Join a room
  socket.on("join-room", async ({ roomId, user }) => {
    try {
      socket.join(roomId);

      // Get or create room in memory
      let room = rooms.get(roomId);
      const isNewRoom = !room;

      if (!room) {
        // Initialize room in memory if not exists
        console.log(`Initializing room ${roomId} in memory`);
        room = {
          users: new Set(),
          elements: [],
          appState: {},
          userIdMap: {}, // Map socket.id to user.dbId for saving
          lastUpdateTime: null,
          lastUpdateSocket: null,
        };
        rooms.set(roomId, room);

        // Try to load room data from database if available
        try {
          const roomData = await roomDataQueries.getRoomData(roomId);
          if (roomData) {
            room.elements = JSON.parse(roomData.elements || "[]");
            room.appState = JSON.parse(roomData.app_state || "{}");
            console.log(
              `Loaded room data from database for ${roomId} (${room.elements.length} elements, version ${roomData.version})`
            );
          } else {
            console.log(
              `No saved data found for room ${roomId}, starting fresh`
            );
          }
        } catch (dbError) {
          console.warn(
            `Could not load room data from DB:`,
            dbError.message
          );
          // Continue with empty room
        }
      }

      // Add user to room and store user ID for saving
      room.users.add(socket.id);
      if (user?.dbId) {
        room.userIdMap[socket.id] = user.dbId;
        
        // Track room joined activity
        analyticsQueries.trackActivity(user.dbId, roomId, 'room_joined')
          .catch(err => console.error('Error tracking room join:', err));
        
        // Update room stats (view count)
        analyticsQueries.updateRoomStats(roomId, 'view')
          .catch(err => console.error('Error updating room stats:', err));
      }

      // IMPORTANT: Send current room state to the new user
      // This ensures they get the latest data without affecting existing users
      socket.emit("room-state", {
        elements: room.elements || [],
        appState: room.appState || {},
        isInitialLoad: true, // Flag to indicate this is initial load
      });

      console.log(
        `Sent room state to new user: ${room.elements.length} elements`
      );

      // Notify others in the room about new user (WITHOUT sending state)
      socket.to(roomId).emit("user-joined", {
        userId: socket.id,
        user: user,
      });

      // Send user count update to ALL users
      io.to(roomId).emit("user-count", room.users.size);

      console.log(
        `✓ User ${socket.id} (${
          user?.name || "Unknown"
        }) joined room ${roomId} (${room.users.size} users, ${
          room.elements.length
        } elements in room)`
      );
    } catch (error) {
      console.error("Error joining room:", error);
      socket.emit("error", { message: "Failed to join room" });
    }
  });

  // Handle drawing updates
  socket.on("drawing-update", ({ roomId, elements, appState }) => {
    const room = rooms.get(roomId);
    if (room) {
      // Update room state in memory
      room.elements = elements;
      room.appState = appState;
      room.lastUpdateTime = Date.now();
      room.lastUpdateSocket = socket.id;

      // Track drawing activity (throttled - only if significant change)
      const userId = room.userIdMap[socket.id];
      if (userId && elements && elements.length > 0) {
        // Only track every 10 seconds to avoid too many DB writes
        const now = Date.now();
        if (!room.lastDrawingTrack || now - room.lastDrawingTrack > 10000) {
          room.lastDrawingTrack = now;
          analyticsQueries.trackActivity(userId, roomId, 'drawing', { elementCount: elements.length })
            .catch(err => console.error('Error tracking drawing:', err));
          
          // Update room stats (drawing count)
          analyticsQueries.updateRoomStats(roomId, 'drawing')
            .catch(err => console.error('Error updating room stats:', err));
        }
      }

      // Broadcast to all other users in the room
      socket.to(roomId).emit("drawing-update", { elements, appState });

      // Auto-save to database (debounced)
      // Clear previous timeout for this room
      if (room.saveTimeout) {
        clearTimeout(room.saveTimeout);
      }

      // Set new timeout to save after 2 seconds of inactivity
      room.saveTimeout = setTimeout(async () => {
        try {
          // Get the user ID from the socket who made the last update
          const userId = room.userIdMap?.[room.lastUpdateSocket] || null;

          // Save to database
          const savedData = await roomDataQueries.saveRoomData(
            roomId,
            elements,
            appState,
            userId
          );

          console.log(
            `Auto-saved room ${roomId} to database (${
              elements?.length || 0
            } elements, version ${savedData.version})`
          );
        } catch (error) {
          console.error(`Error auto-saving room ${roomId}:`, error);
        }
      }, 2000); // Save after 2 seconds of no updates
    } else {
      console.warn(`Drawing update for unknown room: ${roomId}`);
    }
  });

  // Handle pointer movement with user info
  socket.on("pointer-update", ({ roomId, pointer, user }) => {
    if (!roomId || !pointer) return;
    
    // Broadcast to all other users in the room
    socket.to(roomId).emit("pointer-update", {
      userId: socket.id,
      pointer: {
        x: pointer.x,
        y: pointer.y,
      },
      user: user || {
        id: socket.id,
        name: 'Unknown',
        picture: null,
      },
    });
  });
    // ===== Chat feature =====
  socket.on("chat-message",  async ({ roomId, message, user }) => {
      try {
    // Lưu message vào DB
    const saved = await chatQueries.saveMessage(roomId, user.dbId, message, 'text');

    // Track chat activity
    analyticsQueries.trackActivity(user.dbId, roomId, 'chat', { messageLength: message.length })
      .catch(err => console.error('Error tracking chat:', err));
    
    // Update room stats (message count)
    analyticsQueries.updateRoomStats(roomId, 'message')
      .catch(err => console.error('Error updating room stats:', err));

    // Chuẩn bị data gửi cho client
    const chat = {
      id: saved.id,
      text: saved.content,
      sender: user.name,
      senderId: user.id,
      timestamp: saved.created_at,
      picture: user.picture,
    };

    // Phát message cho tất cả client trong room
    io.to(roomId).emit("chat-message", chat);

    console.log(`[${roomId}] ${user.name}: ${message}`);
  } catch (error) {
    console.error('Error saving chat message:', error);
    socket.emit('error', 'Failed to send message');
  }
  });

  // ===== Typing indicator =====
  socket.on("typing", ({ roomId, user, isTyping }) => {
    socket.to(roomId).emit("user-typing", {
      userId: user.id,
      userName: user.name,
      isTyping,
    });
  });
  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("✗ Socket disconnected:", socket.id);

    // Remove user from all rooms
    rooms.forEach((room, roomId) => {
      if (room.users && room.users.has(socket.id)) {
        room.users.delete(socket.id);

        // Clean up user ID mapping
        if (room.userIdMap && room.userIdMap[socket.id]) {
          delete room.userIdMap[socket.id];
        }

        // Notify others
        io.to(roomId).emit("user-left", { userId: socket.id });
        io.to(roomId).emit("user-count", room.users.size);

        console.log(
          `✓ User ${socket.id} left room ${roomId} (${room.users.size} users remaining)`
        );

        // Clean up empty rooms after 1 hour
        if (room.users.size === 0) {
          setTimeout(() => {
            const currentRoom = rooms.get(roomId);
            if (currentRoom && currentRoom.users.size === 0) {
              rooms.delete(roomId);
              console.log(`🗑️  Room ${roomId} deleted due to inactivity`);
            }
          }, 60 * 60 * 1000); // 1 hour
        }
      }
    });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Socket.io server ready`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Error: Port ${PORT} is already in use.`);
    console.error(`Please either:`);
    console.error(`  1. Stop the process using port ${PORT}`);
    console.error(`  2. Use a different port by setting PORT environment variable (e.g., PORT=5001)`);
    console.error(`\nTo find and kill the process on Windows, run:`);
    console.error(`  netstat -ano | findstr :${PORT}`);
    console.error(`  taskkill /PID <PID> /F\n`);
    process.exit(1);
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});
