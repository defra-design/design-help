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
        can_help_with_text TEXT,
        development_goals TEXT[],
        development_goals_text TEXT,
        project_team VARCHAR(255),
        delivery_group VARCHAR(255),
        linkedin_profile TEXT,
        interests TEXT[],
        availability_status VARCHAR(50) DEFAULT 'Available',
        busy_until DATE,
        contact_email VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
        console.log('Created profiles table.');

        await client.query('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);');

        await client.query(`
      CREATE TABLE IF NOT EXISTS approved_emails (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
        console.log('Created approved_emails table.');

        await client.query(`
      CREATE TABLE IF NOT EXISTS profile_long_term_helping (
        id SERIAL PRIMARY KEY,
        helper_profile_id VARCHAR(255) NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        helpee_profile_id VARCHAR(255) NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT profile_long_term_helping_not_self CHECK (helper_profile_id <> helpee_profile_id),
        CONSTRAINT profile_long_term_helping_unique_pair UNIQUE (helper_profile_id, helpee_profile_id)
      );
    `);
        console.log('Ensured profile_long_term_helping table.');

        // Migrate existing data from JSON
        const teamMembersPath = path.join(__dirname, '..', 'app', 'data', 'team-members.json');
        if (fs.existsSync(teamMembersPath)) {
            console.log('Migrating data from team-members.json...');
            const teamMembers = JSON.parse(fs.readFileSync(teamMembersPath, 'utf8'));

            for (const member of teamMembers) {
                const contactEmail = member.email
                    ? String(member.email).toLowerCase().trim()
                    : null;
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
                        id, name, project_team, delivery_group, role, location, experience, bio, linkedin_profile,
                        can_help_with, can_help_with_text, development_goals, development_goals_text, availability_status,
                        contact_email
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                `, [
                        member.id,
                        member.name,
                        member.projectTeam || null,
                        member.deliveryGroup || null,
                        member.role,
                        member.location,
                        member.experience,
                        member.bio,
                        member.linkedinProfile || null,
                        member.canHelpWith || [],
                        member.canHelpWithText || null,
                        member.developmentGoals || member.interests || [],
                        member.developmentGoalsText || null,
                        member.availability || 'Available',
                        contactEmail
                    ]);
                } else if (contactEmail) {
                    await client.query(
                        'UPDATE profiles SET contact_email = $1 WHERE id = $2',
                        [contactEmail, member.id]
                    );
                }
                if (contactEmail) {
                    await client.query(
                        'INSERT INTO approved_emails (email) VALUES ($1) ON CONFLICT (email) DO NOTHING',
                        [contactEmail]
                    );
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
