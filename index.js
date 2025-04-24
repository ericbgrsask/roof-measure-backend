app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    console.log('Login attempt for username:', username);
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    console.log('Database query result:', result.rows);
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
