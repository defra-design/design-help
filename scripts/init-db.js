const { pool } = require('../app/db');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt'); // Will need to install bcrypt
const saltRounds = 10;

const allowedRoles = new Set([
    'Interaction Designer',
    'Senior Interaction Designer',
    'Service Designer',
    'Senior Service Designer',
    'Principal Service Designer',
    'Head of Design',
    'Design Manager',
    'Senior Resource Manager',
    'Accessibility Specialist (SEO)',
    'Senior Accessibility Specialist (Grade 7)'
]);

const legacyRoleMap = new Map([
    ['Lead Designer', 'Principal Service Designer'],
    ['Lead Service Designer', 'Principal Service Designer'],
    ['User Researcher', 'Service Designer'],
    ['Resource Manager', 'Senior Resource Manager']
]);

function normaliseRoleForProfile(role) {
    const raw = String(role || '').trim();
    if (!raw) return null;
    if (allowedRoles.has(raw)) return raw;
    if (legacyRoleMap.has(raw)) return legacyRoleMap.get(raw);
    return 'Service Designer';
}

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

        await client.query(`
      CREATE TABLE IF NOT EXISTS profile_manager_allocation (
        staff_profile_id VARCHAR(255) PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        manager_profile_id VARCHAR(255) REFERENCES profiles(id) ON DELETE SET NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT profile_manager_allocation_not_self CHECK (
          manager_profile_id IS NULL OR staff_profile_id <> manager_profile_id
        )
      );
    `);
        console.log('Ensured profile_manager_allocation table.');

        // Migrate existing data from JSON
        const teamMembersPath = path.join(__dirname, '..', 'app', 'data', 'team-members.json');
        if (fs.existsSync(teamMembersPath)) {
            console.log('Migrating data from team-members.json...');
            const teamMembers = JSON.parse(fs.readFileSync(teamMembersPath, 'utf8'));
            const migratedUserPasswordHash = await bcrypt.hash('password', saltRounds);

            for (const member of teamMembers) {
                const normalisedRole = normaliseRoleForProfile(member.role);
                if (normalisedRole !== member.role) {
                    console.log(`Normalised role for ${member.id}: "${member.role}" -> "${normalisedRole}"`);
                }
                const contactEmail = member.email
                    ? String(member.email).toLowerCase().trim()
                    : null;
                let linkedUserId = null;
                if (contactEmail) {
                    const existingUser = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [contactEmail]);
                    if (existingUser.rows.length > 0) {
                        linkedUserId = existingUser.rows[0].id;
                    } else {
                        const createdUser = await client.query(
                            'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
                            [contactEmail, migratedUserPasswordHash]
                        );
                        linkedUserId = createdUser.rows[0].id;
                    }
                }
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
                        id, user_id, name, project_team, delivery_group, role, location, experience, bio, linkedin_profile,
                        can_help_with, can_help_with_text, development_goals, development_goals_text, availability_status,
                        contact_email
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                `, [
                        member.id,
                        linkedUserId,
                        member.name,
                        member.projectTeam || null,
                        member.deliveryGroup || null,
                        normalisedRole,
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
                } else {
                    await client.query(
                        `UPDATE profiles SET
                          role = COALESCE($1, role),
                          can_help_with = $2::text[],
                          can_help_with_text = $3,
                          contact_email = COALESCE($4, contact_email),
                          user_id = COALESCE($5, user_id)
                        WHERE id = $6`,
                        [
                            normalisedRole,
                            member.canHelpWith || [],
                            member.canHelpWithText || null,
                            contactEmail,
                            linkedUserId,
                            member.id
                        ]
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
