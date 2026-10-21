const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// PostgreSQL Connection Pool using Render's DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

app.use(express.json());

// Basic health check route
app.get('/', (req, res) => {
  res.send('Swift Dispatch API is running successfully!');
});

// Database connection test route
app.get('/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ success: true, time: result.rows[0].now });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});
const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

// 1. Parsing and Static File Middleware (Put this FIRST)
app.use(express.json());
app.use(express.static('.')); // Serves index.html at root automatically

// 2. PostgreSQL Pool Setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// NOTE: Make sure to REMOVE or COMMENT OUT any app.get('/', ...) route 
// so it doesn't override index.html!

app.use(express.static('.' ));

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
