const express = require('express');
const { Pool } = require('pg');
const PDFDocument = require('pdfkit');
const { createCanvas } = require('canvas');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Define the PostgreSQL connection pool using environment variables
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Enable CORS
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increase limit for image data

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Test route to confirm server is running
app.get('/', (req, res) => res.send('Backend is running'));

// JWT Secret Key from environment variable
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid token.' });
  }
};

// Login endpoint
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
    // Compare the provided password with the stored hashed password
    const validPassword = await bcrypt.compare(password, user.password);
    console.log('Password comparison result:', validPassword);

    if (!validPassword) {
      console.log('Password mismatch for user:', username);
      return res.status(400).json({ error: 'Invalid username or password.' });
    }

    // Generate a JWT token
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// Hash passwords before storing (for initial setup or registration)
app.post('/register', async (req, res) => {
  const { username, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id',
      [username, hashedPassword]
    );
    res.json({ id: result.rows[0].id });
  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// Protect the existing endpoints
app.post('/projects', authenticateToken, async (req, res) => {
  const { address, polygons } = req.body;
  const result = await pool.query(
    'INSERT INTO projects (address, polygons) VALUES ($1, $2) RETURNING id',
    [address, JSON.stringify(polygons)]
  );
  res.json({ id: result.rows[0].id });
});

app.get('/projects/:id', authenticateToken, async (req, res) => {
  const result = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
  res.json(result.rows[0]);
});

app.post('/generate-pdf', authenticateToken, async (req, res) => {
  const { address, screenshot, polygons, areas, totalArea } = req.body;

  // Create a new PDF document
  const doc = new PDFDocument({ margin: 50 });
  let buffers = [];
  doc.on('data', buffers.push.bind(buffers));
  doc.on('end', () => {
    const pdfData = Buffer.concat(buffers);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=roof-measure-report.pdf');
    res.send(pdfData);
  });

  // Add header with company name and date
  doc.fontSize(20).font('Helvetica-Bold').text('Saskatoon Roof Measure Report', { align: 'center' });
  doc.fontSize(12).font('Helvetica').text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
  doc.moveDown(2);

  // Add project address
  doc.fontSize(14).font('Helvetica-Bold').text('Project Address:', { underline: true });
  doc.fontSize(12).font('Helvetica').text(address || 'Not provided');
  doc.moveDown(1.5);

  // Add the map screenshot
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

  // Add polygon coordinates section
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

  // Add area calculations section
  doc.fontSize(14).font('Helvetica-Bold').text('Area Calculations:', { underline: true });
  doc.moveDown(0.5);
  const tableTop = doc.y;
  const col1 = 50;
  const col2 = 150;
  doc.fontSize(12).font('Helvetica-Bold').text('Section', col1, tableTop);
  doc.text('Area (SQFT)', col2, tableTop);
  doc.moveDown(0.5);
  let yPosition = doc.y;
  areas.forEach((area) => {
    doc.fontSize(10).font('Helvetica').text(area.section, col1, yPosition);
    doc.text(area.area, col2, yPosition);
    yPosition += 15;
  });
  doc.moveDown(1);
  doc.fontSize(12).font('Helvetica-Bold').text(`Total Flat Area: ${totalArea} SQFT`);

  // Finalize the PDF
  doc.end();
});

// Use PORT environment variable or default to 3000
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
