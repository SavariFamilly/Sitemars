require('dotenv').config();
const express = require('express');
const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require('path');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// --- Turso DB ---
const db = createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_TOKEN,
});

// --- Simple session store (in-memory, keyed by token) ---
const sessions = new Map();
const SESSION_DURATION = 4 * 60 * 60 * 1000; // 4 hours

function authMiddleware(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (!token || !sessions.has(token)) {
        return res.status(401).json({ error: 'Non autorisé' });
    }
    const session = sessions.get(token);
    if (Date.now() > session.expiresAt) {
        sessions.delete(token);
        return res.status(401).json({ error: 'Session expirée' });
    }
    next();
}

// ============================================================
//  AUTH
// ============================================================
app.post('/api/login', async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) {
            return res.status(400).json({ error: 'Mot de passe requis' });
        }

        const result = await db.execute({
            sql: 'SELECT password_hash FROM admin_users WHERE username = ?',
            args: ['redacteur'],
        });

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Accès refusé' });
        }

        const valid = await bcrypt.compare(password, result.rows[0].password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Mot de passe incorrect' });
        }

        const token = uuidv4();
        sessions.set(token, { expiresAt: Date.now() + SESSION_DURATION });

        res.json({ token, message: 'Bienvenue dans la rédaction' });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/logout', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (token) sessions.delete(token);
    res.json({ message: 'Déconnecté' });
});

// ============================================================
//  LETTRES À LA RÉDACTION
// ============================================================

// Public: submit a letter
app.post('/api/letters/submit', async (req, res) => {
    try {
        const { author_name, author_faction, subject, content } = req.body;
        if (!author_name || !subject || !content) {
            return res.status(400).json({ error: 'Champs requis: author_name, subject, content' });
        }
        const id = uuidv4();
        await db.execute({
            sql: `INSERT INTO letters (id, author_name, author_faction, subject, content)
                  VALUES (?, ?, ?, ?, ?)`,
            args: [id, author_name, author_faction || null, subject, content],
        });
        res.json({ id, message: 'Lettre soumise avec succès' });
    } catch (err) {
        console.error('Submit letter error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: list all letters
app.get('/api/letters', authMiddleware, async (req, res) => {
    try {
        const status = req.query.status || null;
        let result;
        if (status) {
            result = await db.execute({
                sql: 'SELECT * FROM letters WHERE status = ? ORDER BY submitted_at DESC',
                args: [status],
            });
        } else {
            result = await db.execute('SELECT * FROM letters ORDER BY submitted_at DESC');
        }
        res.json(result.rows);
    } catch (err) {
        console.error('List letters error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: update letter status
app.put('/api/letters/:id', authMiddleware, async (req, res) => {
    try {
        const { status } = req.body;
        if (!['pending', 'approved', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'Statut invalide' });
        }
        await db.execute({
            sql: `UPDATE letters SET status = ?, reviewed_at = datetime('now') WHERE id = ?`,
            args: [status, req.params.id],
        });
        res.json({ message: 'Lettre mise à jour' });
    } catch (err) {
        console.error('Update letter error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: delete letter
app.delete('/api/letters/:id', authMiddleware, async (req, res) => {
    try {
        await db.execute({
            sql: 'DELETE FROM letters WHERE id = ?',
            args: [req.params.id],
        });
        res.json({ message: 'Lettre supprimée' });
    } catch (err) {
        console.error('Delete letter error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ============================================================
//  PETITES ANNONCES — COMPTES
// ============================================================

// Admin: list accounts
app.get('/api/classifieds/accounts', authMiddleware, async (req, res) => {
    try {
        const result = await db.execute('SELECT id, username, display_name, quota_max, quota_used, active, created_at FROM classifieds_accounts ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('List accounts error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: create account
app.post('/api/classifieds/accounts', authMiddleware, async (req, res) => {
    try {
        const { username, display_name, password, quota_max } = req.body;
        if (!username || !display_name || !password) {
            return res.status(400).json({ error: 'Champs requis: username, display_name, password' });
        }

        const hash = await bcrypt.hash(password, 10);
        const id = uuidv4();

        await db.execute({
            sql: `INSERT INTO classifieds_accounts (id, username, display_name, password_hash, quota_max)
                  VALUES (?, ?, ?, ?, ?)`,
            args: [id, username, display_name, hash, quota_max || 3],
        });
        res.json({ id, message: 'Compte créé' });
    } catch (err) {
        if (err.message?.includes('UNIQUE')) {
            return res.status(409).json({ error: 'Ce nom d\'utilisateur existe déjà' });
        }
        console.error('Create account error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: update account
app.put('/api/classifieds/accounts/:id', authMiddleware, async (req, res) => {
    try {
        const { display_name, quota_max, active, password } = req.body;
        const fields = [];
        const args = [];

        if (display_name !== undefined) { fields.push('display_name = ?'); args.push(display_name); }
        if (quota_max !== undefined) { fields.push('quota_max = ?'); args.push(quota_max); }
        if (active !== undefined) { fields.push('active = ?'); args.push(active ? 1 : 0); }
        if (password) {
            const hash = await bcrypt.hash(password, 10);
            fields.push('password_hash = ?');
            args.push(hash);
        }

        if (fields.length === 0) {
            return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
        }

        args.push(req.params.id);
        await db.execute({
            sql: `UPDATE classifieds_accounts SET ${fields.join(', ')} WHERE id = ?`,
            args,
        });
        res.json({ message: 'Compte mis à jour' });
    } catch (err) {
        console.error('Update account error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: delete account
app.delete('/api/classifieds/accounts/:id', authMiddleware, async (req, res) => {
    try {
        await db.execute({
            sql: 'DELETE FROM classifieds WHERE account_id = ?',
            args: [req.params.id],
        });
        await db.execute({
            sql: 'DELETE FROM classifieds_accounts WHERE id = ?',
            args: [req.params.id],
        });
        res.json({ message: 'Compte et annonces associées supprimés' });
    } catch (err) {
        console.error('Delete account error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ============================================================
//  PETITES ANNONCES — UTILISATEUR PUBLIC
// ============================================================

// Public User: Login
app.post('/api/classifieds/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Identifiants requis' });

        const result = await db.execute({
            sql: 'SELECT id, password_hash, display_name, quota_used, quota_max, active FROM classifieds_accounts WHERE username = ?',
            args: [username],
        });

        if (result.rows.length === 0 || !result.rows[0].active) {
            return res.status(401).json({ error: 'Compte introuvable ou inactif' });
        }

        const valid = await bcrypt.compare(password, result.rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: 'Mot de passe incorrect' });

        const token = uuidv4();
        sessions.set(token, { expiresAt: Date.now() + SESSION_DURATION, accountId: result.rows[0].id });

        res.json({
            token,
            account: {
                id: result.rows[0].id,
                display_name: result.rows[0].display_name,
                quota_used: result.rows[0].quota_used,
                quota_max: result.rows[0].quota_max
            }
        });
    } catch (err) {
        console.error('Classifieds login error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// User auth middleware
function userAuthMiddleware(req, res, next) {
    const token = req.headers['x-user-token'];
    if (!token || !sessions.has(token)) return res.status(401).json({ error: 'Non autorisé' });

    const session = sessions.get(token);
    if (Date.now() > session.expiresAt || !session.accountId) {
        sessions.delete(token);
        return res.status(401).json({ error: 'Session expirée ou invalide' });
    }

    req.accountId = session.accountId;
    next();
}

// User: Get My Ads
app.get('/api/classifieds/my', userAuthMiddleware, async (req, res) => {
    try {
        const [ads, acc] = await Promise.all([
            db.execute({
                sql: "SELECT * FROM classifieds WHERE account_id = ? ORDER BY created_at DESC",
                args: [req.accountId]
            }),
            db.execute({
                sql: "SELECT quota_used, quota_max FROM classifieds_accounts WHERE id = ?",
                args: [req.accountId]
            })
        ]);
        res.json({ ads: ads.rows, quota: acc.rows[0] });
    } catch (err) {
        console.error('Get my ads error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// User: Publish My Ad
app.post('/api/classifieds/my', userAuthMiddleware, async (req, res) => {
    try {
        const { title, content, category } = req.body;
        if (!title || !content) return res.status(400).json({ error: 'Titre et contenu requis' });

        // Check quota
        const account = await db.execute({
            sql: 'SELECT quota_used, quota_max FROM classifieds_accounts WHERE id = ?',
            args: [req.accountId],
        });

        if (account.rows[0].quota_used >= account.rows[0].quota_max) {
            return res.status(429).json({ error: "Quota d'annonces atteint" });
        }

        const id = uuidv4();
        await db.execute({
            sql: `INSERT INTO classifieds (id, account_id, title, content, category)
                  VALUES (?, ?, ?, ?, ?)`,
            args: [id, req.accountId, title, content, category || null],
        });

        // Increment quota
        await db.execute({
            sql: 'UPDATE classifieds_accounts SET quota_used = quota_used + 1 WHERE id = ?',
            args: [req.accountId],
        });

        res.json({ id, message: 'Annonce publiée avec succès' });
    } catch (err) {
        console.error('Publish my ad error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// User: Update My Ad
app.put('/api/classifieds/my/:id', userAuthMiddleware, async (req, res) => {
    try {
        const { title, content, category } = req.body;
        if (!title || !content) return res.status(400).json({ error: 'Titre et contenu requis' });

        // Ensure the ad belongs to the user
        const check = await db.execute({
            sql: 'SELECT id FROM classifieds WHERE id = ? AND account_id = ?',
            args: [req.params.id, req.accountId]
        });

        if (check.rows.length === 0) return res.status(404).json({ error: 'Annonce introuvable ou non autorisée' });

        await db.execute({
            sql: `UPDATE classifieds SET title = ?, content = ?, category = ?, status = 'active' WHERE id = ?`,
            args: [title, content, category || null, req.params.id],
        });

        res.json({ message: 'Annonce mise à jour' });
    } catch (err) {
        console.error('Update my ad error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ============================================================
//  PETITES ANNONCES — ANNONCES
// ============================================================

// Public: list active classifieds
app.get('/api/classifieds/public', async (req, res) => {
    try {
        const result = await db.execute(`
            SELECT c.*, ca.display_name as author_name
            FROM classifieds c
            JOIN classifieds_accounts ca ON c.account_id = ca.id
            WHERE c.status = 'active' AND ca.active = 1
            ORDER BY c.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('List public classifieds error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: list all classifieds
app.get('/api/classifieds', authMiddleware, async (req, res) => {
    try {
        const result = await db.execute(`
            SELECT c.*, ca.display_name as author_name, ca.username as author_username
            FROM classifieds c
            JOIN classifieds_accounts ca ON c.account_id = ca.id
            ORDER BY c.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('List classifieds error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: create classified (on behalf of account)
app.post('/api/classifieds', authMiddleware, async (req, res) => {
    try {
        const { account_id, title, content, category } = req.body;
        if (!account_id || !title || !content) {
            return res.status(400).json({ error: 'Champs requis: account_id, title, content' });
        }

        // Check quota
        const account = await db.execute({
            sql: 'SELECT * FROM classifieds_accounts WHERE id = ?',
            args: [account_id],
        });
        if (account.rows.length === 0) {
            return res.status(404).json({ error: 'Compte introuvable' });
        }
        const acc = account.rows[0];
        if (acc.quota_used >= acc.quota_max) {
            return res.status(429).json({ error: `Quota atteint (${acc.quota_max} annonces max)` });
        }

        const id = uuidv4();
        await db.execute({
            sql: `INSERT INTO classifieds (id, account_id, title, content, category)
                  VALUES (?, ?, ?, ?, ?)`,
            args: [id, account_id, title, content, category || null],
        });

        // Increment quota
        await db.execute({
            sql: 'UPDATE classifieds_accounts SET quota_used = quota_used + 1 WHERE id = ?',
            args: [account_id],
        });

        res.json({ id, message: 'Annonce créée' });
    } catch (err) {
        console.error('Create classified error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: update classified status
app.put('/api/classifieds/:id', authMiddleware, async (req, res) => {
    try {
        const { title, content, category, status } = req.body;
        const fields = [];
        const args = [];

        if (title !== undefined) { fields.push('title = ?'); args.push(title); }
        if (content !== undefined) { fields.push('content = ?'); args.push(content); }
        if (category !== undefined) { fields.push('category = ?'); args.push(category); }
        if (status !== undefined) { fields.push('status = ?'); args.push(status); }

        if (fields.length === 0) {
            return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
        }

        args.push(req.params.id);
        await db.execute({
            sql: `UPDATE classifieds SET ${fields.join(', ')} WHERE id = ?`,
            args,
        });
        res.json({ message: 'Annonce mise à jour' });
    } catch (err) {
        console.error('Update classified error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: delete classified
app.delete('/api/classifieds/:id', authMiddleware, async (req, res) => {
    try {
        // Decrement quota
        const cl = await db.execute({
            sql: 'SELECT account_id FROM classifieds WHERE id = ?',
            args: [req.params.id],
        });
        if (cl.rows.length > 0) {
            await db.execute({
                sql: 'UPDATE classifieds_accounts SET quota_used = MAX(0, quota_used - 1) WHERE id = ?',
                args: [cl.rows[0].account_id],
            });
        }

        await db.execute({
            sql: 'DELETE FROM classifieds WHERE id = ?',
            args: [req.params.id],
        });
        res.json({ message: 'Annonce supprimée' });
    } catch (err) {
        console.error('Delete classified error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ============================================================
//  AVIS DE RECHERCHE
// ============================================================

// Public: list active wanted posters
app.get('/api/wanted/public', async (req, res) => {
    try {
        const result = await db.execute(
            "SELECT * FROM wanted_posters WHERE status = 'active' ORDER BY created_at DESC"
        );
        res.json(result.rows);
    } catch (err) {
        console.error('List public wanted error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: list all wanted posters
app.get('/api/wanted', authMiddleware, async (req, res) => {
    try {
        const result = await db.execute('SELECT * FROM wanted_posters ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('List wanted error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: create wanted poster
app.post('/api/wanted', authMiddleware, async (req, res) => {
    try {
        const { name, alias, description, crimes, reward, image_url, danger_level } = req.body;
        if (!name || !description) {
            return res.status(400).json({ error: 'Champs requis: name, description' });
        }
        const id = uuidv4();
        await db.execute({
            sql: `INSERT INTO wanted_posters (id, name, alias, description, crimes, reward, image_url, danger_level)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [id, name, alias || null, description, crimes || null, reward || null, image_url || null, danger_level || 'moyen'],
        });
        res.json({ id, message: 'Avis de recherche créé' });
    } catch (err) {
        console.error('Create wanted error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: update wanted poster
app.put('/api/wanted/:id', authMiddleware, async (req, res) => {
    try {
        const { name, alias, description, crimes, reward, image_url, danger_level, status } = req.body;
        const fields = [];
        const args = [];

        if (name !== undefined) { fields.push('name = ?'); args.push(name); }
        if (alias !== undefined) { fields.push('alias = ?'); args.push(alias); }
        if (description !== undefined) { fields.push('description = ?'); args.push(description); }
        if (crimes !== undefined) { fields.push('crimes = ?'); args.push(crimes); }
        if (reward !== undefined) { fields.push('reward = ?'); args.push(reward); }
        if (image_url !== undefined) { fields.push('image_url = ?'); args.push(image_url); }
        if (danger_level !== undefined) { fields.push('danger_level = ?'); args.push(danger_level); }
        if (status !== undefined) { fields.push('status = ?'); args.push(status); }
        fields.push("updated_at = datetime('now')");

        if (fields.length <= 1) {
            return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
        }

        args.push(req.params.id);
        await db.execute({
            sql: `UPDATE wanted_posters SET ${fields.join(', ')} WHERE id = ?`,
            args,
        });
        res.json({ message: 'Avis mis à jour' });
    } catch (err) {
        console.error('Update wanted error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: delete wanted poster
app.delete('/api/wanted/:id', authMiddleware, async (req, res) => {
    try {
        const id = req.params.id;
        console.log(`Suppression de l'avis de recherche avec ID: ${id}`);
        const result = await db.execute({
            sql: 'DELETE FROM wanted_posters WHERE id = ?',
            args: [id],
        });
        console.log(`Résultat de la suppression: ${result.rowsAffected} lignes affectées.`);
        res.json({ message: 'Avis de recherche supprimé' });
    } catch (err) {
        console.error('Delete wanted error:', err);
        res.status(500).json({ error: 'Erreur serveur lors de la suppression' });
    }
});

// ============================================================
//  STATS (for dashboard)
// ============================================================
app.get('/api/stats', authMiddleware, async (req, res) => {
    try {
        const [letters, classifieds, wanted, accounts] = await Promise.all([
            db.execute('SELECT status, COUNT(*) as count FROM letters GROUP BY status'),
            db.execute('SELECT status, COUNT(*) as count FROM classifieds GROUP BY status'),
            db.execute('SELECT status, COUNT(*) as count FROM wanted_posters GROUP BY status'),
            db.execute('SELECT COUNT(*) as count FROM classifieds_accounts WHERE active = 1'),
        ]);

        const letterStats = { pending: 0, approved: 0, rejected: 0 };
        letters.rows.forEach(r => { letterStats[r.status] = Number(r.count); });

        const classifiedStats = { active: 0, moderated: 0 };
        classifieds.rows.forEach(r => { classifiedStats[r.status] = Number(r.count); });

        const wantedStats = { active: 0, archived: 0 };
        wanted.rows.forEach(r => { wantedStats[r.status] = Number(r.count); });

        res.json({
            letters: letterStats,
            classifieds: classifiedStats,
            wanted: wantedStats,
            activeAccounts: Number(accounts.rows[0]?.count || 0),
        });
    } catch (err) {
        console.error('Stats error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ============================================================
//  START
// ============================================================

try {
    console.log('🔄 Exécution de init-db.js...');
    execSync('node init-db.js', { stdio: 'inherit' });
    console.log('✅ Base de données initialisée.');
} catch (err) {
    console.error('❌ Erreur lors de l\'initialisation de la DB:', err.message);
}

app.listen(PORT, () => {
    console.log(`\n✦ La Gazette de la Serre — Serveur démarré`);
    console.log(`  http://localhost:${PORT}`);
    console.log(`  http://localhost:${PORT}/admin.html\n`);
});
