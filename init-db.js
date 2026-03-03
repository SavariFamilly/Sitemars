require('dotenv').config();
const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const db = createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_TOKEN,
});

async function initDatabase() {
    console.log('🔧 Initialisation de la base de données Turso...\n');

    // --- Admin users ---
    await db.execute(`
        CREATE TABLE IF NOT EXISTS admin_users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);
    console.log('✓ Table admin_users créée');

    // --- Lettres à la Rédaction ---
    await db.execute(`
        CREATE TABLE IF NOT EXISTS letters (
            id TEXT PRIMARY KEY,
            author_name TEXT NOT NULL,
            author_faction TEXT,
            subject TEXT NOT NULL,
            content TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            submitted_at TEXT DEFAULT (datetime('now')),
            reviewed_at TEXT
        )
    `);
    console.log('✓ Table letters créée');

    // --- Comptes Petites Annonces ---
    await db.execute(`
        CREATE TABLE IF NOT EXISTS classifieds_accounts (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            quota_max INTEGER DEFAULT 3,
            quota_used INTEGER DEFAULT 0,
            active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);
    console.log('✓ Table classifieds_accounts créée');

    // --- Petites Annonces ---
    await db.execute(`
        CREATE TABLE IF NOT EXISTS classifieds (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            category TEXT,
            status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (account_id) REFERENCES classifieds_accounts(id)
        )
    `);
    console.log('✓ Table classifieds créée');

    // --- Avis de Recherche ---
    await db.execute(`
        CREATE TABLE IF NOT EXISTS wanted_posters (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            alias TEXT,
            description TEXT NOT NULL,
            crimes TEXT,
            reward TEXT,
            image_url TEXT,
            danger_level TEXT DEFAULT 'moyen',
            status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);
    console.log('✓ Table wanted_posters créée');

    // --- Seed admin user ---
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
        console.error('✗ ADMIN_PASSWORD non défini dans .env');
        process.exit(1);
    }

    const existing = await db.execute({
        sql: 'SELECT id FROM admin_users WHERE username = ?',
        args: ['redacteur'],
    });

    if (existing.rows.length === 0) {
        const hash = await bcrypt.hash(adminPassword, 12);
        await db.execute({
            sql: 'INSERT INTO admin_users (id, username, password_hash) VALUES (?, ?, ?)',
            args: [uuidv4(), 'redacteur', hash],
        });
        console.log('✓ Compte admin "redacteur" créé avec mot de passe haché');
    } else {
        // Update password hash in case it changed
        const hash = await bcrypt.hash(adminPassword, 12);
        await db.execute({
            sql: 'UPDATE admin_users SET password_hash = ? WHERE username = ?',
            args: [hash, 'redacteur'],
        });
        console.log('✓ Mot de passe admin "redacteur" mis à jour');
    }

    console.log('\n✅ Base de données initialisée avec succès !');
    process.exit(0);
}

initDatabase().catch((err) => {
    console.error('Erreur lors de l\'initialisation :', err);
    process.exit(1);
});
