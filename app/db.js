/**
 * Singleton PostgreSQL pool for the application.
 * Behaviour and TLS notes for production reviewers: ARCHITECTURE.md
 */
const { Pool } = require('pg')
require('dotenv').config()

const isProduction = process.env.NODE_ENV === 'production'

const connectionString = process.env.DATABASE_URL

if (!connectionString && isProduction) {
  throw new Error('DATABASE_URL environment variable is required in production')
}

const config = {
  connectionString: connectionString,
  ssl: isProduction ? { rejectUnauthorized: false } : false
}

const pool = new Pool(config)

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool: pool
}
