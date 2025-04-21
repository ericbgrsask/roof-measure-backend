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
    res.cookie('token', token, {
      httpOnly: true,
      secure: true, // Always secure on Render (HTTPS)
      sameSite: 'none',
      maxAge: 3600000
    });
    console.log('Setting token cookie with options:', { httpOnly: true, secure: true, sameSite: 'none', maxAge: 3600000 });
    res.json({ message: 'Login successful' });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

app.post('/logout', csrfProtection, (req, res) => {
  res.cookie('token', '', {
    httpOnly: true,
    secure: true, // Always secure on Render (HTTPS)
    sameSite: 'none',
    maxAge: 0
  });
  console.log('Clearing token cookie with options:', { httpOnly: true, secure: true, sameSite: 'none', maxAge: 0 });
  res.json({ message: 'Logout successful' });
});
