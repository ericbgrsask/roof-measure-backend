const bcrypt = require('bcrypt');

(async () => {
  try {
    const password = 'password123';
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log('Hashed password:', hashedPassword);
  } catch (error) {
    console.error('Error generating hash:', error);
  }
})();
