// server.js
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
require('dotenv').config();
const brevo = require('@getbrevo/brevo');
const { userQueries, roomQueries, collaboratorQueries, roomDataQueries } = require('./database');

const app = express();
const server = http.createServer(app);

// Tạo transporter 1 lần duy nhất 
const emailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  pool: true, 
  maxConnections: 5,
  maxMessages: 100
});

const io = new Server(server, {
  cors: {
    origin: ['http://localhost:3000', 'https://collab-board-ptit.vercel.app'],
    credentials: true,
    methods: ['GET', 'POST']
  }
});

app.use(cors({
  origin: ['http://localhost:3000', 'https://collab-board-ptit.vercel.app'],
  credentials: true
}));

app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    sameSite: 'none',  
    secure: true,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback'
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
        picture: profile.photos[0].value
      };
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }
));

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
  res.status(401).json({ error: 'Unauthorized' });
};

app.get('/', (req, res) => {
  res.json({ message: 'CollabBoard API Server' });
});

app.get('/auth/google',
  passport.authenticate('google', { 
    scope: ['profile', 'email'] 
  })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { 
    failureRedirect: 'https://collab-board-ptit.vercel.app' 
  }),
  (req, res) => {
    console.log('✓ User logged in:', req.user?.email);
    res.redirect('https://collab-board-ptit.vercel.app');
  }
);

app.get('/auth/status', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ 
      authenticated: true, 
      user: req.user 
    });
  } else {
    res.json({ 
      authenticated: false 
    });
  }
});

app.post('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    req.session.destroy();
    res.json({ message: 'Logged out successfully' });
  });
});

app.get('/api/user/profile', isAuthenticated, (req, res) => {
  res.json({ user: req.user });
});

// Room management
const rooms = new Map(); // roomId -> { users: Set, elements: [], appState: {} }
const userRoomCreationTimestamps = new Map(); // userId -> timestamp (rate limiting)

// Create a new room
app.post('/api/rooms/create', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.dbId;
    const lastCreation = userRoomCreationTimestamps.get(userId) || 0;
    const now = Date.now();
    const timeSinceLastCreation = now - lastCreation;
    
    if (timeSinceLastCreation < 2000) { 
      console.log(`User ${req.user.email} trying to create room too quickly. Blocked.`);
      return res.status(429).json({ 
        error: 'Please wait before creating another room',
        retryAfter: Math.ceil((2000 - timeSinceLastCreation) / 1000)
      });
    }
    
    // Update timestamp
    userRoomCreationTimestamps.set(userId, now);
    
    const { name, description } = req.body;
    
    console.log(`Creating room for user ${req.user.email}...`);
    
    // Create room in database
    const dbRoom = await roomQueries.createRoom(
      name || 'Untitled Room',
      description || '',
      userId
    );
    
    console.log(`✅ Room created: ${dbRoom.id} by ${req.user.email}`);
    
    // Also keep in memory for real-time collaboration
    rooms.set(dbRoom.id, {
      users: new Set(),
      elements: [],
      appState: {},
      userIdMap: {},
      createdBy: req.user.email,
      createdAt: new Date()
    });
    
    res.json({ 
      roomId: dbRoom.id, 
      room: dbRoom,
      shareUrl: `http://localhost:3000/room/${dbRoom.id}` 
    });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// Get room info
app.get('/api/rooms/:roomId', isAuthenticated, async (req, res) => {
  try {
    const { roomId } = req.params;
    
    // Get from database
    const dbRoom = await roomQueries.getRoomById(roomId);
    
    if (!dbRoom) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    // Get in-memory room for active user count
    const memRoom = rooms.get(roomId);
    
    // Get collaborators
    const collaborators = await collaboratorQueries.getCollaborators(roomId);
    
    res.json({
      ...dbRoom,
      userCount: memRoom ? memRoom.users.size : 0,
      collaborators,
      isOwner: dbRoom.owner_id === req.user.dbId
    });
  } catch (error) {
    console.error('Error getting room:', error);
    res.status(500).json({ error: 'Failed to get room' });
  }
});

// Get all rooms (owned + collaborated)
app.get('/api/rooms', isAuthenticated, async (req, res) => {
  try {
    const ownedRooms = await roomQueries.getRoomsByOwner(req.user.dbId);
    const collaboratedRooms = await roomQueries.getRoomsByCollaborator(req.user.dbId);
    
    res.json({
      owned: ownedRooms,
      collaborated: collaboratedRooms
    });
  } catch (error) {
    console.error('Error getting rooms:', error);
    res.status(500).json({ error: 'Failed to get rooms' });
  }
});

// Update room details
app.put('/api/rooms/:roomId', isAuthenticated, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { name, description } = req.body;
    
    // Check if user is owner
    const isOwner = await roomQueries.isOwner(roomId, req.user.dbId);
    if (!isOwner) {
      return res.status(403).json({ error: 'Only room owner can update room details' });
    }
    
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    
    const updatedRoom = await roomQueries.updateRoom(roomId, updates);
    res.json(updatedRoom);
  } catch (error) {
    console.error('Error updating room:', error);
    res.status(500).json({ error: 'Failed to update room' });
  }
});

// Delete room
app.delete('/api/rooms/:roomId', isAuthenticated, async (req, res) => {
  try {
    const { roomId } = req.params;
    
    // Check if user is owner
    const isOwner = await roomQueries.isOwner(roomId, req.user.dbId);
    if (!isOwner) {
      return res.status(403).json({ error: 'Only room owner can delete room' });
    }
    
    await roomQueries.deleteRoom(roomId);
    
    // Remove from memory
    rooms.delete(roomId);
    
    res.json({ message: 'Room deleted successfully' });
  } catch (error) {
    console.error('Error deleting room:', error);
    res.status(500).json({ error: 'Failed to delete room' });
  }
});

// Add collaborator to room
app.post('/api/rooms/:roomId/collaborators', isAuthenticated, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { email, role } = req.body;
    
    // Check if user is owner
    const isOwner = await roomQueries.isOwner(roomId, req.user.dbId);
    if (!isOwner) {
      return res.status(403).json({ error: 'Only room owner can add collaborators' });
    }
    
    // Find user by email
    const collaboratorUser = await userQueries.findByEmail(email);
    if (!collaboratorUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if already owner
    const room = await roomQueries.getRoomById(roomId);
    if (room.owner_id === collaboratorUser.id) {
      return res.status(400).json({ error: 'User is already the owner' });
    }
    
    const collaborator = await collaboratorQueries.addCollaborator(
      roomId, 
      collaboratorUser.id, 
      role || 'editor',
      req.user.dbId
    );
    
    res.json(collaborator);
  } catch (error) {
    console.error('Error adding collaborator:', error);
    res.status(500).json({ error: 'Failed to add collaborator' });
  }
});

// Remove collaborator from room
app.delete('/api/rooms/:roomId/collaborators/:userId', isAuthenticated, async (req, res) => {
  try {
    const { roomId, userId } = req.params;
    
    // Check if user is owner
    const isOwner = await roomQueries.isOwner(roomId, req.user.dbId);
    if (!isOwner) {
      return res.status(403).json({ error: 'Only room owner can remove collaborators' });
    }
    
    await collaboratorQueries.removeCollaborator(roomId, parseInt(userId));
    res.json({ message: 'Collaborator removed successfully' });
  } catch (error) {
    console.error('Error removing collaborator:', error);
    res.status(500).json({ error: 'Failed to remove collaborator' });
  }
});

// Update collaborator role
app.put('/api/rooms/:roomId/collaborators/:userId', isAuthenticated, async (req, res) => {
  try {
    const { roomId, userId } = req.params;
    const { role } = req.body;
    
    // Check if user is owner
    const isOwner = await roomQueries.isOwner(roomId, req.user.dbId);
    if (!isOwner) {
      return res.status(403).json({ error: 'Only room owner can update collaborator roles' });
    }
    
    const updatedCollaborator = await collaboratorQueries.updateCollaboratorRole(
      roomId, 
      parseInt(userId), 
      role
    );
    res.json(updatedCollaborator);
  } catch (error) {
    console.error('Error updating collaborator:', error);
    res.status(500).json({ error: 'Failed to update collaborator' });
  }
});

// Get room drawing data (for verification)
app.get('/api/rooms/:roomId/data', isAuthenticated, async (req, res) => {
  try {
    const { roomId } = req.params;
    
    // Check if user has access
    const hasAccess = await roomQueries.hasAccess(roomId, req.user.dbId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const roomData = await roomDataQueries.getRoomData(roomId);
    if (!roomData) {
      return res.json({ 
        roomId,
        hasData: false,
        message: 'No drawing data saved yet' 
      });
    }
    
    const elements = JSON.parse(roomData.elements || '[]');
    const appState = JSON.parse(roomData.app_state || '{}');
    
    res.json({
      roomId,
      hasData: true,
      version: roomData.version,
      elementCount: elements.length,
      lastUpdate: roomData.updated_at,
      elements: elements,
      appState: appState
    });
  } catch (error) {
    console.error('Error getting room data:', error);
    res.status(500).json({ error: 'Failed to get room data' });
  }
});

app.post('/api/rooms/invite', isAuthenticated, async (req, res) => {
  const { roomId, emails } = req.body;
  
  if (!roomId || !emails || !Array.isArray(emails)) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  
  const room = await roomQueries.getRoomById(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const shareUrl = `http://localhost:3000/room/${roomId}`;
  
  res.json({ success: true, message: 'Đang gửi lời mời...' });
  
  let apiInstance = new brevo.TransactionalEmailsApi();
  apiInstance.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
  
  const emailPromises = emails.map(email => {
    let sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.subject = `${req.user.name} mời bạn vẽ cùng trên CollabBoard`;
    sendSmtpEmail.htmlContent = `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2 style="color: #4285f4;">Lời mời tham gia bảng vẽ!</h2>
        <p><strong>${req.user.name}</strong> mời bạn tham gia.</p>
        <p><a href="${shareUrl}" style="padding: 12px 25px; background-color: #4285f4; color: white; text-decoration: none; border-radius: 6px;">THAM GIA NGAY</a></p>
      </div>
    `;
    sendSmtpEmail.sender = { name: "CollabBoard", email: process.env.BREVO_SENDER_EMAIL };
    sendSmtpEmail.to = [{ email: email }];
    
    return apiInstance.sendTransacEmail(sendSmtpEmail);
  });
  
  Promise.all(emailPromises)
    .then(() => console.log(`✓ Sent ${emails.length} invitations`))
    .catch((error) => console.error('Email error:', error));
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('✓ Socket connected:', socket.id);
  
  // Join a room
  socket.on('join-room', async ({ roomId, user }) => {
    try {
      socket.join(roomId);
      
      // Get or create room in memory
      let room = rooms.get(roomId);
      const isNewRoom = !room;
      
      if (!room) {
        // Initialize room in memory if not exists
        console.log(`📦 Initializing room ${roomId} in memory`);
        room = {
          users: new Set(),
          elements: [],
          appState: {},
          userIdMap: {}, // Map socket.id to user.dbId for saving
          lastUpdateTime: null,
          lastUpdateSocket: null
        };
        rooms.set(roomId, room);
        
        // Try to load room data from database if available
        try {
          const roomData = await roomDataQueries.getRoomData(roomId);
          if (roomData) {
            room.elements = JSON.parse(roomData.elements || '[]');
            room.appState = JSON.parse(roomData.app_state || '{}');
            console.log(`✓ Loaded room data from database for ${roomId} (${room.elements.length} elements, version ${roomData.version})`);
          } else {
            console.log(`No saved data found for room ${roomId}, starting fresh`);
          }
        } catch (dbError) {
          console.warn(`⚠️  Could not load room data from DB:`, dbError.message);
          // Continue with empty room
        }
      }
      
      // Add user to room and store user ID for saving
      room.users.add(socket.id);
      if (user?.dbId) {
        room.userIdMap[socket.id] = user.dbId;
      }
      
      // IMPORTANT: Send current room state to the new user
      // This ensures they get the latest data without affecting existing users
      socket.emit('room-state', {
        elements: room.elements || [],
        appState: room.appState || {},
        isInitialLoad: true // Flag to indicate this is initial load
      });
      
      console.log(`📤 Sent room state to new user: ${room.elements.length} elements`);
      
      // Notify others in the room about new user (WITHOUT sending state)
      socket.to(roomId).emit('user-joined', {
        userId: socket.id,
        user: user
      });
      
      // Send user count update to ALL users
      io.to(roomId).emit('user-count', room.users.size);
      
      console.log(`✓ User ${socket.id} (${user?.name || 'Unknown'}) joined room ${roomId} (${room.users.size} users, ${room.elements.length} elements in room)`);
    } catch (error) {
      console.error('❌ Error joining room:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });
  
  // Handle drawing updates
  socket.on('drawing-update', ({ roomId, elements, appState }) => {
    const room = rooms.get(roomId);
    if (room) {
      // Update room state in memory
      room.elements = elements;
      room.appState = appState;
      room.lastUpdateTime = Date.now();
      room.lastUpdateSocket = socket.id;
      
      // Broadcast to all other users in the room
      socket.to(roomId).emit('drawing-update', { elements, appState });
      
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
          
          console.log(`💾 Auto-saved room ${roomId} to database (${elements?.length || 0} elements, version ${savedData.version})`);
        } catch (error) {
          console.error(`❌ Error auto-saving room ${roomId}:`, error);
        }
      }, 2000); // Save after 2 seconds of no updates
    } else {
      console.warn(`⚠️  Drawing update for unknown room: ${roomId}`);
    }
  });
  
  // Handle pointer movement
  socket.on('pointer-update', ({ roomId, pointer, user }) => {
    socket.to(roomId).emit('pointer-update', {
      userId: socket.id,
      pointer,
      user
    });
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('✗ Socket disconnected:', socket.id);
    
    // Remove user from all rooms
    rooms.forEach((room, roomId) => {
      if (room.users && room.users.has(socket.id)) {
        room.users.delete(socket.id);
        
        // Clean up user ID mapping
        if (room.userIdMap && room.userIdMap[socket.id]) {
          delete room.userIdMap[socket.id];
        }
        
        // Notify others
        io.to(roomId).emit('user-left', { userId: socket.id });
        io.to(roomId).emit('user-count', room.users.size);
        
        console.log(`✓ User ${socket.id} left room ${roomId} (${room.users.size} users remaining)`);
        
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
});