const { pool } = require('../app/db');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt'); // Will need to install bcrypt
const saltRounds = 10;

async function initDb() {
    const client = await pool.connect();

    try {
        console.log('Starting database initialization...');

        await client.query('BEGIN');

        // Create users table
        await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
        console.log('Created users table.');

        // Create profiles table
        await client.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id VARCHAR(255) PRIMARY KEY, -- Using string ID as in JSON
        user_id INTEGER REFERENCES users(id),
        name VARCHAR(255) NOT NULL,
        role VARCHAR(255),
        location VARCHAR(255),
        experience TEXT,
        bio TEXT,
        skills TEXT[],
        can_help_with TEXT[], -- stored as array of strings
        interests TEXT[],
        availability_status VARCHAR(50) DEFAULT 'Available',
        busy_until DATE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
        console.log('Created profiles table.');

        // Migrate existing data from JSON
        const teamMembersPath = path.join(__dirname, '..', 'app', 'data', 'team-members.json');
        if (fs.existsSync(teamMembersPath)) {
            console.log('Migrating data from team-members.json...');
            const teamMembers = JSON.parse(fs.readFileSync(teamMembersPath, 'utf8'));

            for (const member of teamMembers) {
                // Check if profile exists
                const res = await client.query('SELECT id FROM profiles WHERE id = $1', [member.id]);
                if (res.rows.length === 0) {
                    // Determine availability status and date
                    // Mapping old availability string to new structure if needed, 
                    // but implementation plan says we are enhancing it.
                    // For migration, we'll keep it simple or default to 'Available' 
                    // if the old format doesn't match new enum.
                    // Old data has "availability": "string"

                    await client.query(`
                    INSERT INTO profiles (
                        id, name, role, location, experience, bio, skills, can_help_with, interests, availability_status
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                `, [
                        member.id,
                        member.name,
                        member.role,
                        member.location,
                        member.experience,
                        member.bio,
                        member.skills || [],
                        member.canHelpWith || [],
                        member.interests || [],
                        member.availability || 'Available'
                    ]);
                }
            }
            console.log(`Migrated ${teamMembers.length} profiles.`);
        }

        await client.query('COMMIT');
        console.log('Database initialization complete.');

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error initializing database:', e);
        process.exit(1);
    } finally {
        client.release();
        pool.end();
    }
}

initDb();
