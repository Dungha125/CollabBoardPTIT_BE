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
const axios = require('axios');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// ✅ Helper function: Gửi email qua Resend API (tránh SMTP timeout trên Railway)
async function sendEmailViaResend({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY not configured');
  }
  
  try {
    const response = await axios.post('https://api.resend.com/emails', {
      from: process.env.EMAIL_FROM || 'CollabBoard <onboarding@resend.dev>',
      to: Array.isArray(to) ? to : [to],
      subject,
      html
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000 // 10s timeout
    });
    
    return response.data;
  } catch (error) {
    const errMsg = error.response?.data?.message || error.message;
    throw new Error(`Resend API error: ${errMsg}`);
  }
}

const io = new Server(server, {
  cors: {
    origin: 'https://collab-board-ptit.vercel.app',
    credentials: true,
    methods: ['GET', 'POST']
  }
});

app.use(cors({
  origin: 'https://collab-board-ptit.vercel.app', 
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
  (accessToken, refreshToken, profile, done) => {
    const user = {
      id: profile.id,
      name: profile.displayName,
      email: profile.emails[0].value,
      picture: profile.photos[0].value
    };
    return done(null, user);
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

// Create a new room
app.post('/api/rooms/create', isAuthenticated, (req, res) => {
  const roomId = uuidv4();
  rooms.set(roomId, {
    users: new Set(),
    elements: [],
    appState: {},
    createdBy: req.user.email,
    createdAt: new Date()
  });
  res.json({ roomId, shareUrl: `https://collab-board-ptit.vercel.app/room/${roomId}` });
});

// Get room info
app.get('/api/rooms/:roomId', isAuthenticated, (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  res.json({
    roomId,
    userCount: room.users.size,
    createdBy: room.createdBy,
    createdAt: room.createdAt
  });
});

// Send invitation email
app.post('/api/rooms/invite', isAuthenticated, async (req, res) => {
  const { roomId, emails } = req.body;
  
  if (!roomId || !emails || !Array.isArray(emails)) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const shareUrl = `https://collab-board-ptit.vercel.app/room/${roomId}`;
  
  // ✅ TRẢ RESPONSE NGAY LẬP TỨC (không chờ email)
  res.json({ 
    success: true, 
    message: 'Đang gửi lời mời qua email...',
    shareUrl: shareUrl
  });
  
  // ✅ Gửi email trong background qua Resend API (không block response)
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 8px; max-width: 600px;">
      <h2 style="color: #4285f4;">🎨 Lời mời tham gia CollabBoard</h2>
      <p>Chào bạn,</p>
      <p><strong>${req.user.name}</strong> (${req.user.email}) đã mời bạn tham gia vẽ cùng trên CollabBoard!</p>
      <p style="margin-top: 30px; text-align: center;">
        <a href="${shareUrl}" style="display: inline-block; padding: 14px 30px; background-color: #4285f4; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
          🚀 Tham gia ngay
        </a>
      </p>
      <p style="font-size: 13px; color: #666; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
        Hoặc copy link này: <br/>
        <a href="${shareUrl}" style="color: #4285f4; word-break: break-all;">${shareUrl}</a>
      </p>
    </div>
  `;
  
  const emailPromises = emails.map(email => 
    sendEmailViaResend({
      to: email,
      subject: `${req.user.name} mời bạn vào CollabBoard`,
      html: emailHtml
    })
  );
  
  // Xử lý email trong background
  Promise.all(emailPromises)
    .then((results) => {
      console.log(`✅ Sent ${emails.length} email(s) for room ${roomId} via Resend API`);
      console.log('Email IDs:', results.map(r => r.id).join(', '));
    })
    .catch((error) => {
      console.error(`❌ Failed to send emails for room ${roomId}:`, error.message);
      console.error('⚠️  Kiểm tra: RESEND_API_KEY có đúng không? Sender email đã verify chưa?');
    });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Join a room
  socket.on('join-room', ({ roomId, user }) => {
    socket.join(roomId);
    
    const room = rooms.get(roomId);
    if (room) {
      room.users.add(socket.id);
      
      // Send current room state to the new user
      socket.emit('room-state', {
        elements: room.elements,
        appState: room.appState
      });
      
      // Notify others in the room
      socket.to(roomId).emit('user-joined', {
        userId: socket.id,
        user: user
      });
      
      // Send user count update
      io.to(roomId).emit('user-count', room.users.size);
      
      console.log(`User ${socket.id} joined room ${roomId}`);
    }
  });
  
  // Handle drawing updates
  socket.on('drawing-update', ({ roomId, elements, appState }) => {
    const room = rooms.get(roomId);
    if (room) {
      // Update room state
      room.elements = elements;
      room.appState = appState;
      
      // Broadcast to all other users in the room
      socket.to(roomId).emit('drawing-update', { elements, appState });
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
    console.log('User disconnected:', socket.id);
    
    // Remove user from all rooms
    rooms.forEach((room, roomId) => {
      if (room.users.has(socket.id)) {
        room.users.delete(socket.id);
        
        // Notify others
        io.to(roomId).emit('user-left', { userId: socket.id });
        io.to(roomId).emit('user-count', room.users.size);
        
        // Clean up empty rooms after 1 hour
        if (room.users.size === 0) {
          setTimeout(() => {
            const currentRoom = rooms.get(roomId);
            if (currentRoom && currentRoom.users.size === 0) {
              rooms.delete(roomId);
              console.log(`Room ${roomId} deleted due to inactivity`);
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