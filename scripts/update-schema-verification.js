const { pool } = require('../app/db');

async function updateSchema() {
    const client = await pool.connect();
    try {
        console.log('Updating database schema for email verification...');

        await client.query('BEGIN');

        // Add is_verified column
        await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
    `);

        // Add verification_code column
        await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS verification_code VARCHAR(6);
    `);

        // Consider existing users verified for backward compatibility?
        // Let's set them to verified so they aren't locked out.
        await client.query(`
        UPDATE users SET is_verified = TRUE WHERE is_verified IS FALSE AND verification_code IS NULL;
    `);

        await client.query('COMMIT');
        console.log('Schema update complete.');

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error updating schema:', e);
    } finally {
        client.release();
        pool.end();
    }
}

updateSchema();
