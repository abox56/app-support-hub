require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const mysql = require('mysql2/promise');

const app = express();
app.use(express.json());

const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

let db;
(async () => {
    const useMySQL = !!(process.env.MYSQLHOST || process.env.DATABASE_URL || process.env.MYSQL_URL || process.env.MYSQL_PRIVATE_URL);

    if (useMySQL) {
        console.log("💎 MySQL Configuration Detected. (Railway Mode)");
        try {
            const connectionString = process.env.MYSQL_PRIVATE_URL || process.env.MYSQL_URL || process.env.DATABASE_URL;
            const config = connectionString ? connectionString : {
                host: process.env.MYSQLHOST,
                user: process.env.MYSQLUSER,
                password: process.env.MYSQLPASSWORD,
                database: process.env.MYSQLDATABASE,
                port: process.env.MYSQLPORT || 3306,
                ssl: { rejectUnauthorized: false } // Required for some remote DBs
            };

            const pool = mysql.createPool(config);

            // Test connection
            await pool.query('SELECT 1');
            console.log("✅ MySQL Connection Test Passed.");

            // Unified DB Shim (MySQL uses query/execute with different param handling than SQLite)
            db = {
                all: async (sql, params = []) => {
                    const [rows] = await pool.execute(sql, params);
                    return rows;
                },
                get: async (sql, params = []) => {
                    const [rows] = await pool.execute(sql, params);
                    return rows[0];
                },
                run: async (sql, params = []) => {
                    const [result] = await pool.execute(sql, params);
                    return { lastID: result.insertId, changes: result.affectedRows };
                },
                exec: async (sql) => {
                    // For massive schema init, we split and use query
                    const statements = sql.split(';').filter(s => s.trim().length > 0);
                    for (let s of statements) {
                        try {
                            await pool.query(s);
                            console.log(`🛠️ Table/Index created: ${s.substring(0, 40).replace(/\n/g, ' ')}...`);
                        } catch (err) {
                            if (!err.message.includes("already exists")) {
                                console.error(`⚠️ Schema warning: ${err.message}`);
                            }
                        }
                    }
                }
            };

            await db.exec(`
                CREATE TABLE IF NOT EXISTS incidents (
                    id VARCHAR(255) PRIMARY KEY,
                    first_timestamp VARCHAR(100),
                    last_update VARCHAR(100),
                    category VARCHAR(100),
                    main_content TEXT,
                    ai_summary TEXT,
                    status VARCHAR(50),
                    assigned_to VARCHAR(100),
                    source VARCHAR(255),
                    duration_minutes INT,
                    message_ids TEXT,
                    engine VARCHAR(50)
                );
                CREATE TABLE IF NOT EXISTS incident_updates (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    incident_id VARCHAR(255),
                    timestamp VARCHAR(100),
                    sender VARCHAR(255),
                    content TEXT,
                    msg_id BIGINT,
                    chat_id VARCHAR(255),
                    INDEX(incident_id)
                );
                CREATE TABLE IF NOT EXISTS message_analysis_logs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    msg_id BIGINT,
                    chat_id VARCHAR(255),
                    chat_title VARCHAR(255),
                    sender VARCHAR(255),
                    content TEXT,
                    timestamp VARCHAR(100),
                    ai_category VARCHAR(100),
                    ai_summary TEXT,
                    is_noise BOOLEAN,
                    confidence INT,
                    engine VARCHAR(50),
                    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS roster_weeks (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    title VARCHAR(255),
                    date_range VARCHAR(255)
                );
                CREATE TABLE IF NOT EXISTS roster_shifts (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    week_id INT,
                    day_name VARCHAR(50),
                    time_slot VARCHAR(100),
                    person_name VARCHAR(100),
                    shift_status VARCHAR(255),
                    INDEX(week_id),
                    INDEX(day_name)
                );
            `);
            console.log("✅ MySQL Database schema fully initialized.");
        } catch (e) {
            console.error("❌ MySQL Init Failed:", e.message);
            db = null; // Ensure fallback happens
        }
    }

    // Fallback or explicit SQLite 
    if (!db) {
        const dbPath = process.env.DB_PATH || path.join(__dirname, 'hub_storage.db');
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        await db.exec(`
            CREATE TABLE IF NOT EXISTS incidents (
                id TEXT PRIMARY KEY,
                first_timestamp TEXT,
                last_update TEXT,
                category TEXT,
                main_content TEXT,
                ai_summary TEXT,
                status TEXT,
                assigned_to TEXT,
                source TEXT,
                duration_minutes INTEGER,
                message_ids TEXT,
                engine TEXT
            );
            CREATE TABLE IF NOT EXISTS incident_updates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                incident_id TEXT,
                timestamp TEXT,
                sender TEXT,
                content TEXT,
                msg_id INTEGER,
                chat_id TEXT,
                FOREIGN KEY(incident_id) REFERENCES incidents(id)
            );
            CREATE TABLE IF NOT EXISTS message_analysis_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                msg_id INTEGER,
                chat_id TEXT,
                chat_title TEXT,
                sender TEXT,
                content TEXT,
                timestamp TEXT,
                ai_category TEXT,
                ai_summary TEXT,
                is_noise BOOLEAN,
                confidence INTEGER,
                engine TEXT,
                processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS roster_weeks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                date_range TEXT
            );
            CREATE TABLE IF NOT EXISTS roster_shifts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                week_id INTEGER,
                day_name TEXT,
                time_slot TEXT,
                person_name TEXT,
                shift_status TEXT,
                FOREIGN KEY(week_id) REFERENCES roster_weeks(id)
            );
        `);
        console.log(`✅ SQLite Database initialized at: ${dbPath}`);
    }

    // --- Seeding Roster ---
    try {
        const rosterCount = await db.get(`SELECT COUNT(*) as count FROM roster_weeks`);
        if (rosterCount && rosterCount.count === 0) {
            console.log("🌱 Seeding roster data from roster.json...");
            const ROSTER_FILE = path.join(__dirname, 'roster.json');
            if (fs.existsSync(ROSTER_FILE)) {
                const rosterData = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8'));
                for (let week of rosterData) {
                    if (!week.title || week.title.trim() === "" || week.title.trim() === " ") continue;
                    
                    const wRes = await db.run(`INSERT INTO roster_weeks (title, date_range) VALUES (?, ?)`, [week.title, week.dateRange]);
                    const weekId = wRes.lastID;
                    
                    if (week.days) {
                        for (let day of Object.keys(week.days)) {
                            if (day.length > 20) continue; 
                            for (let slot of week.days[day]) {
                                const time = slot.time;
                                for (let person of ["Ivan", "Shawn", "DJ"]) {
                                    if (slot[person] !== undefined) {
                                        await db.run(
                                            `INSERT INTO roster_shifts (week_id, day_name, time_slot, person_name, shift_status) VALUES (?, ?, ?, ?, ?)`,
                                            [weekId, day, time, person, slot[person]]
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
                console.log("✅ Roster seeding complete.");
            }
        }
    } catch (e) {
        console.error("❌ Failed to seed roster:", e.message);
    }
})();

const PORT = process.env.PORT || 8000;
const HUB_PASSWORD = process.env.HUB_PASSWORD || "Cloudway2026!";

// Middleware to check for authentication (Bypass for validation API)
app.use((req, res, next) => {
    if (req.path === '/api/validate-password') return next();
    
    if (req.path.startsWith('/api/')) {
        const clientKey = req.headers['authorization'];
        if (clientKey !== HUB_PASSWORD) {
            return res.status(401).json({ error: "Unauthorized: Invalid HUB_PASSWORD" });
        }
    }
    next();
});

// API: Validate Password
app.post('/api/validate-password', (req, res) => {
    const { password } = req.body;
    if (password === HUB_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, error: "Incorrect Hub Security Key" });
    }
});

// Telegram Configuration
const apiId = parseInt(process.env.TG_API_ID || "36039479");
const apiHash = process.env.TG_API_HASH || "cbb4b1ed8cf7605931c48a56140366d7";
const stringSession = new StringSession(process.env.TG_SESSION || "");

let tgClient;
async function analyzeMessageAI(content) {
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "") {
        return { category: categorizeIncident(content), summary: content, isNoise: false, engine: 'Keywords' };
    }

    const prompt = `
    Analyze this application support message: "${content}"
    
    Categorize into one of these:
    [USER_SUPPORT]: User help requests, balance issues, login problems.
    [PROVIDER_ALERTS]: Provider maintenance, game lag, odds changes (e.g. Evolution, Pragmatic).
    [SYSTEM_LOGS]: Server alerts, database lag, network busy.
    [NOISE]: Greetings, irrelevant chat, emojis, single words.

    Return JSON format:
    {
      "category": "CATEGORY_NAME",
      "summary": "1-sentence actionable summary",
      "isNoise": true/false,
      "confidence": 0-100
    }
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().replace(/```json|```/g, "").trim();
        const data = JSON.parse(text);
        data.engine = 'Gemini 1.5';
        return data;
    } catch (e) {
        console.error("AI Analysis Failed:", e);
        return { category: categorizeIncident(content), summary: content, isNoise: false, engine: 'Keywords (Fallback)' };
    }
}

async function addTelegramIncident(groupTitle, senderName, content, msgId, chatId) {
    const analysis = await analyzeMessageAI(content);
    const now = new Date();

    // Insert into message_analysis_logs
    try {
        await db.run(
            `INSERT INTO message_analysis_logs 
            (msg_id, chat_id, chat_title, sender, content, timestamp, ai_category, ai_summary, is_noise, confidence, engine) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                msgId, 
                chatId ? chatId.toString() : null, 
                groupTitle, 
                senderName, 
                content, 
                now.toISOString(), 
                analysis.category, 
                analysis.summary || null, 
                analysis.isNoise || false, 
                analysis.confidence || 0, 
                analysis.engine
            ]
        );
    } catch (e) {
        console.error("Failed to insert into message_analysis_logs:", e.message);
    }

    // NEW PRESERVE-ALL LOGIC: No message is discarded.
    // Categorize into NOISE if identified, but still save for analysis.
    let finalCategory = analysis.category;
    if (analysis.isNoise && analysis.confidence > 80) {
        finalCategory = "[NOISE]";
        console.log(`📠 Silent Logging (Noise): ${content.substring(0, 30)}...`);
    }

    const WINDOW_MINUTES = 10;
    const WINDOW_AGO = new Date(now.getTime() - (WINDOW_MINUTES * 60 * 1000)).toISOString();

    // Clustering logic
    const cluster = await db.get(
        `SELECT id FROM incidents 
         WHERE category = ? AND last_update > ? AND status != 'Resolved'
         ORDER BY last_update DESC LIMIT 1`,
        [finalCategory, WINDOW_AGO]
    );

    try {
        if (cluster) {
            // Update existing cluster
            await db.run(
                `UPDATE incidents SET last_update = ?, main_content = ? WHERE id = ?`,
                [now.toISOString(), content, cluster.id]
            );
            // Save detail to updates table
            await db.run(
                `INSERT INTO incident_updates (incident_id, timestamp, sender, content, msg_id, chat_id) VALUES (?, ?, ?, ?, ?, ?)`,
                [cluster.id, now.toISOString(), senderName, content, msgId, chatId ? chatId.toString() : null]
            );
            console.log(`🔗 Clustered with incident [${cluster.id}] (${finalCategory})`);
        } else {
            // Create new incident (even for Noise)
            const id = Date.now().toString();
            await db.run(
                `INSERT INTO incidents (id, first_timestamp, last_update, category, main_content, ai_summary, status, assigned_to, source, duration_minutes, message_ids, engine)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, now.toISOString(), now.toISOString(), finalCategory, content, analysis.summary || "System Capture", 'Captured', 'System', groupTitle, 0, JSON.stringify([msgId]), analysis.engine]
            );
            await db.run(
                `INSERT INTO incident_updates (incident_id, timestamp, sender, content, msg_id, chat_id) VALUES (?, ?, ?, ?, ?, ?)`,
                [id, now.toISOString(), senderName, content, msgId, chatId ? chatId.toString() : null]
            );
            console.log(`🆕 New Activity Created [${id}] (${finalCategory})`);
        }

        // RETENTION: Cleanup incidents older than 90 days
        const NINETY_DAYS_AGO = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000)).toISOString();
        await db.run(`DELETE FROM incident_updates WHERE incident_id IN (SELECT id FROM incidents WHERE last_update < ?)`, [NINETY_DAYS_AGO]);
        await db.run(`DELETE FROM incidents WHERE last_update < ?`, [NINETY_DAYS_AGO]);
    } catch (e) {
        console.error("Database Error in addTelegramIncident:", e.message);
    }
}

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

async function initTelegram() {
    try {
        console.log("⏳ Initializing Telegram Connection...");
        tgClient = new TelegramClient(stringSession, apiId, apiHash, {
            connectionRetries: 3,
        });

        // Timeout wrapper for connection to prevent server freeze
        const connTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error("TG Connection Timeout")), 15000));
        await Promise.race([tgClient.connect(), connTimeout]);
        
        console.log("✅ Connected to Telegram as user.");
        
        // Heartbeat for terminal/logs
        setInterval(async () => {
            if (tgClient && tgClient.connected) {
                try {
                    const me = await tgClient.getMe();
                    console.log(`[${new Date().toLocaleTimeString()}] 💓 TG Heartbeat: @${me?.username || 'User'}`);
                } catch(e) { console.error("Heartbeat fail:", e.message); }
            }
        }, 1000 * 60 * 5);

        tgClient.addEventHandler(async (event) => {
            const message = event.message;
            if (!message || !message.text) return;
            const chat = await message.getChat();
            const sender = await message.getSender();
            
            // LOG EVERYTHING BEFORE FILTERING
            const groupTitle = chat.title || "Private Chat";
            const senderName = sender ? (sender.firstName || sender.username || "Unknown") : "Unknown";
            console.log(`[${new Date().toLocaleTimeString()}] 📥 RAW MSG from [${groupTitle}] by [${senderName}]: ${message.text.trim().substring(0, 50)}`);

            if (chat instanceof Api.Chat || chat instanceof Api.Channel) {
                const groupTitle = chat.title || "Unknown Group";
                const senderName = sender ? (sender.firstName || sender.username || "Unknown") : "Unknown";
                const content = message.text.trim();
                const msgId = message.id;
                const chatId = chat.id;
                
                await addTelegramIncident(groupTitle, senderName, content, msgId, chatId);
            }
        }, new NewMessage({}));
    } catch (e) {
        console.error("❌ Telegram Client Failed to Start:", e.message);
    }
}

// Start Telegram in background so server lives
initTelegram();

// API: AI Status
app.get('/api/ai-status', (req, res) => {
    const hasKey = !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "";
    res.json({ 
        active: hasKey, 
        engine: hasKey ? 'Gemini 1.5 Flash' : 'Keyword Fallback' 
    });
});

// API: Telegram Diagnostics
app.get('/api/tg-diagnostics', async (req, res) => {
    try {
        if (!tgClient || !tgClient.connected) {
            return res.json({ connected: false, message: "TG Client not connected" });
        }
        
        // Timeout wrapper for dialogs to prevent hanging
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Telegram response timeout")), 10000));
        const dialogsPromise = tgClient.getDialogs({ limit: 10 });
        
        const dialogs = await Promise.race([dialogsPromise, timeout]);
        const chats = dialogs.map(d => ({
            id: d.id.toString(),
            title: d.title,
            unreadCount: d.unreadCount,
            lastMessage: d.message ? d.message.message?.substring(0, 30) + '...' : 'No msg'
        }));
        res.json({ connected: true, chatCount: chats.length, chats });
    } catch (e) {
        console.error("Diagnostic Error:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// Simple categorization engine
function categorizeIncident(content) {
    const text = content.toLowerCase();
    if (text.includes('smi') || text.includes('latency')) return 'SMI Monitoring';
    if (text.includes('evolution') || text.includes('pragmatic') || text.includes('provider') || text.includes('mistally') || text.includes('pp-') || text.includes('evo-')) return 'Provider API';
    if (text.includes('ticket') || text.includes('customer') || text.includes('balance') || text.includes('intally') || text.includes('missing')) return 'Customer Support';
    if (text.includes('database') || text.includes('db') || text.includes('node-') || text.includes('unstable') || text.includes('slow')) return 'System Infra';
    return 'General Ops';
}

// API Endpoint to send handover
app.post('/api/send-handover', async (req, res) => {
    const { message, target } = req.body;

    if (!message || !target) {
        return res.status(400).json({ error: "Message and target are required." });
    }

    try {
        if (!tgClient || !tgClient.connected) {
            await initTelegram();
        }

        // Target can be a username, group ID, or 'me'
        await tgClient.sendMessage(target, { message: message, parseMode: 'markdown' });
        res.json({ success: true, status: "Message sent successfully!" });
    } catch (error) {
        console.error("Telegram Error:", error);
        res.status(500).json({ error: "Failed to send message: " + error.message });
    }
});

// API: Get all incidents (last 100 for feed)
app.get('/api/incidents', async (req, res) => {
    try {
        const incidents = await db.all(`SELECT * FROM incidents ORDER BY last_update DESC LIMIT 100`);
        for (let inc of incidents) {
            inc.updates = await db.all(`SELECT * FROM incident_updates WHERE incident_id = ? ORDER BY timestamp ASC`, [inc.id]);
        }
        res.json(incidents);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: Get Raw Message Logs (paginated)
app.get('/api/raw-logs', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 0;
        const limit = 50;
        const offset = page * limit;
        const logs = await db.all(`
            SELECT u.timestamp, u.sender, u.content, i.category, i.source 
            FROM incident_updates u 
            LEFT JOIN incidents i ON u.incident_id = i.id 
            ORDER BY u.timestamp DESC LIMIT ? OFFSET ?`, 
            [limit, offset]
        );
        res.json(logs);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: Download Database Backup
app.get('/api/download-db', (req, res) => {
    const dbPath = process.env.DB_PATH || path.join(__dirname, 'hub_storage.db');
    if (fs.existsSync(dbPath)) {
        res.download(dbPath, `hub_backup_${new Date().toISOString().split('T')[0]}.db`);
    } else {
        res.status(404).send("Database file not found.");
    }
});

// API: Log a new incident (Manual)
app.post('/api/incidents', async (req, res) => {
    const { content, assigned_to } = req.body;
    if (!content) return res.status(400).json({ error: "Content is required" });

    const now = new Date();
    const id = Date.now().toString();
    const analysis = await analyzeMessageAI(content);

    try {
        await db.run(
            `INSERT INTO incidents (id, first_timestamp, last_update, category, main_content, ai_summary, status, assigned_to, source, duration_minutes, message_ids, engine)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, now.toISOString(), now.toISOString(), analysis.category, content, analysis.summary, 'Active', assigned_to || 'Unassigned', 'Manual Input', 0, "[]", analysis.engine]
        );
        await db.run(
            `INSERT INTO incident_updates (incident_id, timestamp, sender, content) VALUES (?, ?, ?, ?)`,
            [id, now.toISOString(), assigned_to || 'System', content]
        );
        res.json({ id, success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: Resolve Incident & Notify TG
app.post('/api/resolve-incident/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const incident = await db.get(`SELECT * FROM incidents WHERE id = ?`, [id]);
        if (!incident) return res.status(404).json({ error: "Incident not found" });

        await db.run(`UPDATE incidents SET status = 'Resolved' WHERE id = ?`, [id]);

        const updates = await db.all(`SELECT DISTINCT msg_id, chat_id FROM incident_updates WHERE incident_id = ?`, [id]);
        
        if (tgClient && tgClient.connected) {
            const replyMsg = `✅ *Issue Resolved* by Hub PIC.\nStatus: Normal.\nCategory: ${incident.category}`;
            for (let update of updates) {
                if (update.msg_id && update.chat_id) {
                    try {
                        await tgClient.sendMessage(update.chat_id, {
                            message: replyMsg,
                            replyTo: update.msg_id,
                            parseMode: 'markdown'
                        });
                        break; 
                    } catch (err) { console.error("Reply fail:", err); }
                }
            }
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Roster Database Helpers
const ROSTER_FILE = path.join(__dirname, 'roster.json');

// API: Get Roster
app.get('/api/roster', (req, res) => {
    try {
        if (!fs.existsSync(ROSTER_FILE)) return res.json([]);
        const rosterData = fs.readFileSync(ROSTER_FILE, 'utf8');
        res.json(JSON.parse(rosterData));
    } catch (e) {
        res.status(500).json({ error: "Failed to read roster" });
    }
});

// Fallback to index.html for unknown routes (SPA style)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 App Support Hub running at http://localhost:${PORT}`);
});
