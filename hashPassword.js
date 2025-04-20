const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  user: 'roof_user',
  host: 'localhost',
  database: 'roof_measure',
  password: '123456',
  port: 5432,
});

(async () => {
  try {
    const password = 'password123';
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query('UPDATE users SET password = $1 WHERE username = $2', [hashedPassword, 'testuser']);
    console.log('Password updated successfully');
  } catch (error) {
    console.error('Error updating password:', error);
  } finally {
    await pool.end();
  }
})();
