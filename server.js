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

const app = express();
const server = http.createServer(app);

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
  
  // Kiểm tra config email
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error('❌ EMAIL_USER or EMAIL_PASS not configured in .env file');
    return res.status(500).json({ 
      error: 'Email service not configured. Please contact administrator.',
      debug: 'EMAIL_USER or EMAIL_PASS missing in environment variables'
    });
  }
  
  // Configure email transporter (using Gmail as example)
  // Note: You need to set EMAIL_USER and EMAIL_PASS in .env
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
  
  const shareUrl = `https://collab-board-ptit.vercel.app/room/${roomId}`;
  
  console.log(`📧 Attempting to send ${emails.length} invitation(s) for room ${roomId}`);
  console.log(`   From: ${process.env.EMAIL_USER}`);
  console.log(`   To: ${emails.join(', ')}`);
  
  // Trả response ngay lập tức cho client
  res.json({ success: true, message: 'Đang gửi lời mời...' });
  
  // Gửi email bất đồng bộ ở background (không chờ)
  const emailPromises = emails.map(email => {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `${req.user.name} đã mời bạn vào CollabBoard`,
      html: `
        <h2>Lời mời vẽ cùng nhau trên CollabBoard</h2>
        <p>${req.user.name} (${req.user.email}) đã mời bạn tham gia vẽ cùng!</p>
        <p>Click vào link dưới đây để tham gia:</p>
        <a href="${shareUrl}" style="display: inline-block; padding: 10px 20px; background-color: #4285f4; color: white; text-decoration: none; border-radius: 5px;">
          Tham gia ngay
        </a>
        <p>Hoặc copy link này: ${shareUrl}</p>
      `
    };
    
    return transporter.sendMail(mailOptions);
  });
  
  // Xử lý lỗi trong background
  Promise.all(emailPromises)
    .then(() => {
      console.log(`✅ Successfully sent ${emails.length} invitation email(s) for room ${roomId}`);
    })
    .catch((error) => {
      console.error('❌ Error sending invitation emails:');
      console.error('   Error details:', error.message);
      console.error('   Full error:', error);
      // Email failed nhưng user đã nhận được response, không ảnh hưởng UX
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