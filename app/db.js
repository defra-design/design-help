const { Pool } = require('pg');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

// Connection configuration
const connectionString = process.env.DATABASE_URL;

if (!connectionString && isProduction) {
  throw new Error('DATABASE_URL environment variable is required in production');
}

// Config object
const config = {
  connectionString: connectionString,
  ssl: isProduction ? { rejectUnauthorized: false } : false
};

// Create a new pool
const pool = new Pool(config);

// Export query method
module.exports = {
  query: (text, params) => pool.query(text, params),
  pool: pool
};
