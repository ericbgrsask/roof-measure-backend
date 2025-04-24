const express = require('express');
const { Pool } = require('pg');
const PDFDocument = require('pdfkit');
const { createCanvas } = require('canvas');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cors = require('cors');
const crypto = require('crypto'); // Add for manual CSRF token generation
require('dotenv').config();

const app = express();

const connectionString = `postgresql://neondb_owner:npg_wIQqnb1JY9xZ@ep-long-term-a4x6exiv-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require`;
const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

const allowedOrigins = ['http://localhost:3000', 'https://roof-measure-frontend.onrender.com'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, origin);
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log('Request headers:', req.headers);
  next();
});

app.get('/', (req, res) => res.send('Backend is running'));

const JWT_SECRET = process.env.JWT_SECRET;

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    console.log('No token provided in headers');
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('Token verified, user:', decoded);
    req.user = decoded;
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    res.status(403).json({ error: 'Invalid token.' });
  }
};

// Manual CSRF token generation
const generateCsrfToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Store CSRF tokens in memory (in production, use a database or Redis)
const csrfTokens = new Map();

app.get('/csrf-token', (req, res) => {
  const token = generateCsrfToken();
  const userId = req.headers['user-id'] || 'anonymous'; // Use user ID if available
  csrfTokens.set(userId, token);
  console.log(`Generated CSRF token for user ${userId}: ${token}`);
  res.json({ csrfToken: token });
});

// Middleware to verify CSRF token
const verifyCsrfToken = (req, res, next) => {
  const userId = req.user ? req.user.id.toString() : 'anonymous';
  const receivedToken = req.headers['x-csrf-token'];
  const storedToken = csrfTokens.get(userId);

  if (!receivedToken || receivedToken !== storedToken) {
    console.log('CSRF token verification failed:', { receivedToken, storedToken });
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  console.log('CSRF token verified successfully');
  next();
};

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    console.log('Login attempt for username:', username);
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];

    if (!user) {
      console.log('User not found:', username);
      return res.status(400).json({ error: 'Invalid username or password.' });
    }

    console.log('Stored hashed password:', user.password);
    const validPassword = await bcrypt.compare(password, user.password);
    console.log('Password comparison result:', validPassword);

    if (!validPassword) {
      console.log('Password mismatch for user:', username);
      return res.status(400).json({ error: 'Invalid username or password.' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
    console.log('Sending login response with token:', token);
    res.json({ message: 'Login successful', token: token });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const existingUser = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Username already exists. Please choose a different username.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    console.log('Registering user - Username:', username, 'Hashed Password:', hashedPassword);
    const result = await pool.query(
      'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id',
      [username, hashedPassword]
    );
    res.json({ message: 'Registration successful', id: result.rows[0].id });
  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

app.post('/logout', verifyCsrfToken, authenticateToken, (req, res) => {
  console.log('Received CSRF token in header:', req.headers['x-csrf-token']);
  res.json({ message: 'Logout successful' });
});

app.get('/projects', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query('SELECT id, address FROM projects WHERE user_id = $1', [userId]);
    res.json(result.rows || []);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Server error fetching projects.' });
  }
});

app.post('/projects', verifyCsrfToken, authenticateToken, async (req, res) => {
  const { address, polygons, pitches } = req.body;
  const userId = req.user.id;
  try {
    const result = await pool.query(
      'INSERT INTO projects (address, polygons, pitches, user_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [address, JSON.stringify(polygons), JSON.stringify(pitches), userId]
    );
    res.json({ id: result.rows[0].id });
  } catch (error) {
    console.error('Error saving project:', error);
    res.status(500).json({ error: 'Server error saving project.' });
  }
});

app.get('/projects/:id', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query('SELECT * FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found or access denied.' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(500).json({ error: 'Server error fetching project.' });
  }
});

app.post('/generate-pdf', verifyCsrfToken, authenticateToken, async (req, res) => {
  const { address, screenshot, polygons, pitches, areas, totalArea } = req.body;

  const doc = new PDFDocument({ margin: 50 });
  let buffers = [];
  doc.on('data', buffers.push.bind(buffers));
  doc.on('end', () => {
    const pdfData = Buffer.concat(buffers);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=roof-measure-report.pdf');
    res.send(pdfData);
  });

  doc.fontSize(20).font('Helvetica-Bold').text('Saskatoon Roof Measure Report', { align: 'center' });
  doc.fontSize(12).font('Helvetica').text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
  doc.moveDown(2);

  doc.fontSize(14).font('Helvetica-Bold').text('Project Address:', { underline: true });
  doc.fontSize(12).font('Helvetica').text(address || 'Not provided');
  doc.moveDown(1.5);

  if (screenshot) {
    try {
      const imgData = screenshot.replace(/^data:image\/png;base64,/, '');
      const imgBuffer = Buffer.from(imgData, 'base64');
      doc.fontSize(14).font('Helvetica-Bold').text('Map Overview:', { underline: true });
      doc.moveDown(0.5);
      doc.image(imgBuffer, { fit: [500, 300], align: 'center' });
      doc.moveDown(1.5);
    } catch (error) {
      console.error('Error adding screenshot to PDF:', error);
      doc.fontSize(12).text('Unable to include map screenshot.', { align: 'center' });
      doc.moveDown(1.5);
    }
  }

  doc.fontSize(14).font('Helvetica-Bold').text('Polygon Coordinates:', { underline: true });
  doc.moveDown(0.5);
  polygons.forEach((poly, index) => {
    doc.fontSize(12).font('Helvetica-Bold').text(`Section ${index + 1}:`);
    poly.forEach((point, i) => {
      doc.fontSize(10).font('Helvetica').text(`Point ${i + 1}: Lat ${point.lat.toFixed(4)}, Lng ${point.lng.toFixed(4)}`);
    });
    doc.moveDown(0.5);
  });
  doc.moveDown(1);

  doc.fontSize(14).font('Helvetica-Bold').text('Area Calculations:', { underline: true });
  doc.moveDown(0.5);
  const tableTop = doc.y;
  const col1 = 50;
  const col2 = 150;
  const col3 = 250;
  doc.fontSize(12).font('Helvetica-Bold').text('Section', col1, tableTop);
  doc.text('Area (SQFT)', col2, tableTop);
  doc.text('Pitch', col3, tableTop);
  doc.moveDown(0.5);
  let yPosition = doc.y;
  areas.forEach((area, index) => {
    doc.fontSize(10).font('Helvetica').text(area.section, col1, yPosition);
    doc.text(area.area, col2, yPosition);
    doc.text(pitches[index] || 'N/A', col3, yPosition);
    yPosition += 15;
  });
  doc.moveDown(1);
  doc.fontSize(12).font('Helvetica-Bold').text(`Total Flat Area: ${totalArea} SQFT`);

  doc.end();
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
