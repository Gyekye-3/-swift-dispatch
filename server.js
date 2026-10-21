const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

// 1. Middleware & Static Frontend Hosting
app.use(express.json());
app.use(express.static('.'));

// 2. PostgreSQL Connection Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 3. Database Initialization
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) CHECK (role IN ('customer', 'driver', 'admin')) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        customer_id INT REFERENCES users(id) ON DELETE CASCADE,
        driver_id INT REFERENCES users(id) ON DELETE SET NULL,
        pickup_location TEXT NOT NULL,
        delivery_location TEXT NOT NULL,
        status VARCHAR(20) CHECK (status IN ('pending', 'assigned', 'in_transit', 'delivered', 'cancelled')) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key VARCHAR(255) PRIMARY KEY,
        response JSONB,
        status VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Database tables initialized successfully.");
  } catch (err) {
    console.error("Database initialization error:", err);
  }
}

initDB();

// 4. Idempotency Middleware
async function handleIdempotency(req, res, next) {
  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey) return next();

  try {
    const existing = await pool.query('SELECT status, response FROM idempotency_keys WHERE key = $1', [idempotencyKey]);

    if (existing.rows.length > 0) {
      const record = existing.rows[0];
      if (record.status === 'processing') {
        return res.status(409).json({ error: 'Request is already processing.' });
      }
      return res.status(200).json(record.response);
    }

    await pool.query('INSERT INTO idempotency_keys (key, status) VALUES ($1, $2)', [idempotencyKey, 'processing']);

    res.sendIdempotentResponse = async (statusCode, payload) => {
      await pool.query(
        'UPDATE idempotency_keys SET status = $1, response = $2 WHERE key = $3',
        ['completed', JSON.stringify(payload), idempotencyKey]
      );
      return res.status(statusCode).json(payload);
    };

    next();
  } catch (err) {
    console.error('Idempotency error:', err);
    next();
  }
}

// 5. API Endpoints
app.post('/api/orders', handleIdempotency, async (req, res) => {
  const { customer_id, pickup_location, delivery_location } = req.body;

  try {
    const query = `
      INSERT INTO orders (customer_id, pickup_location, delivery_location) 
      VALUES ($1, $2, $3) 
      RETURNING *;
    `;
    const result = await pool.query(query, [customer_id, pickup_location, delivery_location]);
    const responsePayload = { message: 'Order created successfully', order: result.rows[0] };

    if (res.sendIdempotentResponse) {
      return res.sendIdempotentResponse(201, responsePayload);
    }

    res.status(201).json(responsePayload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/orders/update-status', async (req, res) => {
  const { order_id, new_status } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const checkOrder = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [order_id]);

    if (checkOrder.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }

    const updateResult = await client.query(
      'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
      [new_status, order_id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Order status updated safely', order: updateResult.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Race condition error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// 6. Server Listener
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`swift-dispatch server listening on port ${PORT}`);
});

server.timeout = 60000;
server.keepAliveTimeout = 65000;

