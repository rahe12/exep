const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

// Middleware
app.use(express.json());
app.use(cors({
  origin: ['http://localhost:3000', 'https://your-mobile-app-domain.com'],
  credentials: true
}));

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// Database initialization
const initializeDatabase = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        role VARCHAR(50) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        price DECIMAL(10,2) NOT NULL,
        cost_price DECIMAL(10,2),
        sku VARCHAR(100) UNIQUE,
        barcode VARCHAR(100),
        image_url VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory (
        id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL DEFAULT 0,
        min_stock_level INTEGER DEFAULT 0,
        max_stock_level INTEGER DEFAULT 1000,
        location VARCHAR(255),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS stock_movements (
        id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id),
        movement_type VARCHAR(50) NOT NULL,
        quantity INTEGER NOT NULL,
        reference_number VARCHAR(100),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }
};

// Routes

// Health check
app.get('/', (req, res) => {
  res.json({
    message: 'Inventory Management API',
    version: '1.0.0',
    status: 'running'
  });
});

// User Authentication
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;

    if (!username || !password || !email) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password, email) VALUES ($1, $2, $3) RETURNING id, username, email, role',
      [username, hashedPassword, email]
    );

    const token = jwt.sign({ id: result.rows[0].id, role: result.rows[0].role }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ user: result.rows[0], token });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ user: { id: user.id, username: user.username, email: user.email, role: user.role }, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Categories Management
app.get('/api/categories', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categories ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/categories', authenticateToken, async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) return res.status(400).json({ error: 'Category name is required' });

    const result = await pool.query(
      'INSERT INTO categories (name, description) VALUES ($1, $2) RETURNING *',
      [name, description]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/categories/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const result = await pool.query(
      'UPDATE categories SET name = $1, description = $2 WHERE id = $3 RETURNING *',
      [name, description, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Category not found' });

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/categories/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM categories WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Category not found' });

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Products Management
app.get('/api/products', authenticateToken, async (req, res) => {
  try {
    const { category_id, search } = req.query;
    let query = `
      SELECT p.*, c.name as category_name, i.quantity, i.min_stock_level, i.max_stock_level, i.location
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN inventory i ON p.id = i.product_id
    `;
    const params = [];

    if (category_id || search) {
      query += ' WHERE';
      if (category_id) {
        query += ' p.category_id = $1';
        params.push(category_id);
      }
      if (search) {
        query += (params.length ? ' AND' : '') + ' p.name ILIKE $' + (params.length + 1);
        params.push(`%${search}%`);
      }
    }

    query += ' ORDER BY p.name';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/products/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT p.*, c.name as category_name, i.quantity, i.min_stock_level, i.max_stock_level, i.location
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN inventory i ON p.id = i.product_id
      WHERE p.id = $1
    `, [id]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/products', authenticateToken, async (req, res) => {
  try {
    const { name, description, category_id, price, cost_price, sku, barcode, image_url, initial_quantity = 0, min_stock_level = 0, max_stock_level = 1000, location } = req.body;

    if (!name || !price) return res.status(400).json({ error: 'Product name and price are required' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const productResult = await client.query(
        'INSERT INTO products (name, description, category_id, price, cost_price, sku, barcode, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
        [name, description, category_id, price, cost_price, sku, barcode, image_url]
      );

      const product = productResult.rows[0];

      await client.query(
        'INSERT INTO inventory (product_id, quantity, min_stock_level, max_stock_level, location) VALUES ($1, $2, $3, $4, $5)',
        [product.id, initial_quantity, min_stock_level, max_stock_level, location]
      );

      if (initial_quantity > 0) {
        await client.query(
          'INSERT INTO stock_movements (product_id, user_id, movement_type, quantity, notes) VALUES ($1, $2, $3, $4, $5)',
          [product.id, req.user.id, 'IN', initial_quantity, 'Initial stock']
        );
      }

      await client.query('COMMIT');
      res.status(201).json(product);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/products/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, category_id, price, cost_price, sku, barcode, image_url } = req.body;

    const result = await pool.query(
      'UPDATE products SET name = $1, description = $2, category_id = $3, price = $4, cost_price = $5, sku = $6, barcode = $7, image_url = $8, updated_at = CURRENT_TIMESTAMP WHERE id = $9 RETURNING *',
      [name, description, category_id, price, cost_price, sku, barcode, image_url, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/products/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });

    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Inventory Management
app.get('/api/inventory', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT i.*, p.name as product_name, p.sku, p.price, p.image_url, c.name as category_name
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      ORDER BY p.name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Get inventory error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/inventory/low-stock', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT i.*, p.name as product_name, p.sku, p.price, p.image_url, c.name as category_name
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE i.quantity <= i.min_stock_level
      ORDER BY i.quantity ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Get low stock error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/inventory/:productId/adjust', authenticateToken, async (req, res) => {
  try {
    const { productId } = req.params;
    const { quantity, movement_type, reference_number, notes } = req.body;

    if (!quantity || !movement_type) return res.status(400).json({ error: 'Quantity and movement type are required' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const inventoryResult = await client.query('SELECT * FROM inventory WHERE product_id = $1', [productId]);
      if (inventoryResult.rows.length === 0) return res.status(404).json({ error: 'Product inventory not found' });

      const currentInventory = inventoryResult.rows[0];
      let newQuantity;

      switch (movement_type) {
        case 'IN':
          newQuantity = currentInventory.quantity + parseInt(quantity);
          break;
        case 'OUT':
          newQuantity = currentInventory.quantity - parseInt(quantity);
          if (newQuantity < 0) throw new Error('Insufficient stock');
          break;
        case 'ADJUSTMENT':
          newQuantity = parseInt(quantity);
          break;
        default:
          throw new Error('Invalid movement type');
      }

      await client.query(
        'UPDATE inventory SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE product_id = $2',
        [newQuantity, productId]
      );

      await client.query(
        'INSERT INTO stock_movements (product_id, user_id, movement_type, quantity, reference_number, notes) VALUES ($1, $2, $3, $4, $5, $6)',
        [productId, req.user.id, movement_type, quantity, reference_number, notes]
      );

      await client.query('COMMIT');
      res.json({
        message: 'Inventory adjusted successfully',
        old_quantity: currentInventory.quantity,
        new_quantity: newQuantity
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Adjust inventory error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Stock Movements
app.get('/api/stock-movements', authenticateToken, async (req, res) => {
  try {
    const { product_id, limit = 50 } = req.query;
    let query = `
      SELECT sm.*, p.name as product_name, p.sku, u.username as user_name
      FROM stock_movements sm
      JOIN products p ON sm.product_id = p.id
      LEFT JOIN users u ON sm.user_id = u.id
    `;
    const params = [];

    if (product_id) {
      query += ' WHERE sm.product_id = $1';
      params.push(product_id);
    }

    query += ' ORDER BY sm.created_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Get stock movements error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Dashboard Statistics
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    const [
      totalProducts,
      totalCategories,
      lowStockProducts,
      totalValue,
      recentMovements
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM products'),
      pool.query('SELECT COUNT(*) FROM categories'),
      pool.query('SELECT COUNT(*) FROM inventory i WHERE i.quantity <= i.min_stock_level'),
      pool.query('SELECT SUM(p.price * i.quantity) as total_value FROM products p JOIN inventory i ON p.id = i.product_id'),
      pool.query(`
        SELECT sm.*, p.name as product_name, p.sku
        FROM stock_movements sm
        JOIN products p ON sm.product_id = p.id
        ORDER BY sm.created_at DESC
        LIMIT 5
      `)
    ]);

    res.json({
      total_products: parseInt(totalProducts.rows[0].count),
      total_categories: parseInt(totalCategories.rows[0].count),
      low_stock_products: parseInt(lowStockProducts.rows[0].count),
      total_inventory_value: parseFloat(totalValue.rows[0].total_value || 0),
      recent_movements: recentMovements.rows
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
const startServer = async () => {
  try {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`Inventory Management API running on port ${PORT}`);
      console.log(`All endpoints are now accessible with proper authentication`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
