require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const mysql = require('mysql2/promise');
const cron = require('node-cron');

const app = express();
app.use(express.json());

const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const primaryModel = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" }); 
const secondaryModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 
const fallbackModel = genAI.getGenerativeModel({ model: "gemini-flash-latest" }); 


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
                isMySQL: true,
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
                    is_support BOOLEAN DEFAULT FALSE,
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
                    row_index INT,
                    time_slot VARCHAR(100),
                    Ivan VARCHAR(100),
                    DJ VARCHAR(100),
                    Shawn VARCHAR(100),
                    note TEXT,
                    swapped BOOLEAN DEFAULT FALSE,
                    INDEX(week_id)
                );
                CREATE TABLE IF NOT EXISTS blacklisted_chats (
                    chat_id VARCHAR(255) PRIMARY KEY,
                    title VARCHAR(255)
                );
                CREATE TABLE IF NOT EXISTS support_members (
                    user_id VARCHAR(255) PRIMARY KEY,
                    name VARCHAR(255)
                );
                CREATE TABLE IF NOT EXISTS public_holidays (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    holiday_date VARCHAR(100) UNIQUE,
                    name VARCHAR(255),
                    is_office_closed BOOLEAN DEFAULT TRUE
                );
                CREATE TABLE IF NOT EXISTS system_config (
                    config_key VARCHAR(255) PRIMARY KEY,
                    config_value TEXT
                );
                CREATE TABLE IF NOT EXISTS manual_scheduled_tasks (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    group_title VARCHAR(255),
                    message TEXT,
                    scheduled_time DATETIME,
                    status ENUM('pending', 'sent', 'failed') DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS tg_pins (
                    chat_title VARCHAR(255) PRIMARY KEY,
                    msg_id BIGINT,
                    chat_id VARCHAR(255)
                );
                CREATE TABLE IF NOT EXISTS time_bank (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    personnel_id VARCHAR(255),
                    balance_hours FLOAT DEFAULT 0.0,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                ALTER TABLE incident_updates ADD COLUMN is_support BOOLEAN DEFAULT FALSE;
                
                -- Ensure required columns exist in roster_shifts
                SET @dbname = DATABASE();
                SET @tablename = 'roster_shifts';
                
                -- Helper to add columns if they don't exist
                -- row_index
                SET @preparedStatement = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'row_index') > 0, 'SELECT 1', 'ALTER TABLE roster_shifts ADD COLUMN row_index INT AFTER day_name'));
                PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

                -- Ivan
                SET @preparedStatement = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'Ivan') > 0, 'SELECT 1', 'ALTER TABLE roster_shifts ADD COLUMN Ivan VARCHAR(100)'));
                PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

                -- DJ
                SET @preparedStatement = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'DJ') > 0, 'SELECT 1', 'ALTER TABLE roster_shifts ADD COLUMN DJ VARCHAR(100)'));
                PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

                -- Shawn
                SET @preparedStatement = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'Shawn') > 0, 'SELECT 1', 'ALTER TABLE roster_shifts ADD COLUMN Shawn VARCHAR(100)'));
                PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

                -- note
                SET @preparedStatement = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'note') > 0, 'SELECT 1', 'ALTER TABLE roster_shifts ADD COLUMN note TEXT'));
                PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

                -- swapped
                SET @preparedStatement = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'swapped') > 0, 'SELECT 1', 'ALTER TABLE roster_shifts ADD COLUMN swapped BOOLEAN DEFAULT FALSE'));
                PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;
            `);
            console.log("✅ MySQL Database schema fully initialized.");

            // Migration: File to DB
            const ROSTER_FILE = path.join(__dirname, 'roster.json');
            const weekCheck = await db.all("SELECT id FROM roster_weeks LIMIT 1");
            if (weekCheck.length === 0 && fs.existsSync(ROSTER_FILE)) {
                console.log("🚚 Migrating roster.json to MySQL...");
                try {
                    const data = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8'));
                    for (const week of data) {
                        const { lastID: weekId } = await db.run("INSERT INTO roster_weeks (title, date_range) VALUES (?, ?)", [week.title, week.dateRange]);
                        for (const day of Object.keys(week.days)) {
                            const dayShifts = week.days[day];
                            for (let i = 0; i < dayShifts.length; i++) {
                                const s = dayShifts[i];
                                await db.run(`INSERT INTO roster_shifts 
                                    (week_id, day_name, row_index, time_slot, Ivan, DJ, Shawn, note, swapped) 
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
                                    [weekId, day, i, s.time || '', s.Ivan || null, s.DJ || null, s.Shawn || null, s.note || null, s.swapped ? 1 : 0]
                                );
                            }
                        }
                    }
                    console.log("✅ Migration complete.");
                } catch (migErr) { console.error("❌ Migration failed:", migErr.message); }
            }
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
                is_support BOOLEAN DEFAULT FALSE,
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
            CREATE TABLE IF NOT EXISTS blacklisted_chats (
                chat_id TEXT PRIMARY KEY,
                title TEXT
            );
            CREATE TABLE IF NOT EXISTS support_members (
                user_id TEXT PRIMARY KEY,
                name TEXT
            );
            CREATE TABLE IF NOT EXISTS public_holidays (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                holiday_date TEXT UNIQUE,
                name TEXT,
                is_office_closed BOOLEAN DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS system_config (
                config_key TEXT PRIMARY KEY,
                config_value TEXT
            );
            CREATE TABLE IF NOT EXISTS tg_pins (
                chat_title TEXT PRIMARY KEY,
                msg_id INTEGER,
                chat_id TEXT
            );
            CREATE TABLE IF NOT EXISTS time_bank (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                personnel_id TEXT,
                balance_hours REAL DEFAULT 0.0,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            -- SQLite doesn't support ADD COLUMN IF NOT EXISTS easily in exec, 
            -- but we can try and it will just fail if it's there
            ALTER TABLE incident_updates ADD COLUMN is_support BOOLEAN DEFAULT FALSE;
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
        return { category: categorizeIncident(content), summary: content, isNoise: false, engine: 'Keywords (Local)' };
    }

    const prompt = `
    Analyze this application support message: "${content}"
    
    Categorize into exactly one of these:
    [USER_SUPPORT]: User help requests, balance issues, login problems, password reset.
    [PROVIDER_ALERTS]: Provider maintenance, game lag, odds changes, wallet transfer issues (e.g. Evolution, Pragmatic).
    [SYSTEM_LOGS]: Server alerts, database lag, network busy, node instability.
    [NOISE]: Greetings, irrelevant chat, emojis, single words.

    Return ONLY a raw JSON object:
    {
      "category": "CATEGORY_NAME",
      "summary": "1-sentence summary",
      "isNoise": true/false,
      "confidence": 0-100
    }
    `;

    try {
        // 1. PRIMARY: Gemini 3 Flash
        const result = await primaryModel.generateContent(prompt);
        const response = await result.response;
        let text = response.text().trim();
        if (text.includes("```")) text = text.split("```")[1].replace(/^json/, "").trim();
        const data = JSON.parse(text);
        data.engine = 'Gemini 3 Flash';
        return data;
    } catch (e) {
        console.error("AI Analysis (Gemini 3) Failed:", e.message);
        try {
            // 2. SECONDARY: Gemini 2.5 Flash
            const result = await secondaryModel.generateContent(prompt);
            const response = await result.response;
            let text = response.text().trim();
            if (text.includes("```")) text = text.split("```")[1].replace(/^json/, "").trim();
            const data = JSON.parse(text);
            data.engine = 'Gemini 2.5 Flash';
            return data;
        } catch (e2) {
            console.error("AI Analysis (Gemini 2.5) Failed:", e2.message);
            try {
                // 3. TERTIARY: Gemini Flash Latest
                const result = await fallbackModel.generateContent(prompt);
                const response = await result.response;
                let text = response.text().trim();
                if (text.includes("```")) text = text.split("```")[1].replace(/^json/, "").trim();
                const data = JSON.parse(text);
                data.engine = 'Gemini Flash Stable';
                return data;
            } catch (e3) {
                 console.error("AI Analysis (Fallbacks) Failed:", e3.message);
                 return { category: categorizeIncident(content), summary: content, isNoise: false, engine: 'Keywords (Fallback)' };
            }
        }
    }
}

async function generateHandoverAI(incidents, picName) {
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "") {
        return null;
    }

    const dateStr = new Date().toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' });

    const incidentList = incidents.map(inc => {
        const count = inc.updates ? inc.updates.length : 1;
        return `- [${inc.category}] ${inc.ai_summary || inc.main_content} (Group: ${inc.source}) ${count > 1 ? `[x${count} messages]` : ''}`;
    }).join('\n');

    const prompt = `
    You are a professional Application Support Lead at Cloudway. Generate a concise, structured Shift Handover report in Markdown for the Telegram group.
    
    Current Date: ${dateStr}
    Current Time: ${timeStr}
    Outgoing PIC: ${picName}
    
    Here are the incidents that occurred during the shift:
    ${incidentList || 'No major incidents reported.'}
    
    Requirements:
    1. Start with a professional header: 🚀 *HUB COMMAND CENTER HANDOVER* 🚀
    2. Include Date, Time, and Outgoing PIC.
    3. Group incidents by their category.
    4. MUST highlight which Telegram group each incident originated from (e.g., [CW App Int Group], [UFABET - Operation]).
    5. Be concise but ensure critical provider alerts or system logs stand out.
    6. Summarize the overall "Shift Vibe" (e.g., Busy, Stable, Noisy).
    7. Use standard Telegram Markdown (*bold*, _italic_).
    8. End with a list of active tasks for the incoming PIC if any incidents are still "Captured" or "Manual Input" and not Resolved.
    `;

    try {
        const result = await primaryModel.generateContent(prompt);
        return (await result.response).text();
    } catch (e) {
        console.error("AI Handover (G3) Failed:", e.message);
        try {
            const result = await secondaryModel.generateContent(prompt);
            return (await result.response).text();
        } catch (e2) {
            console.error("AI Handover (G2.5) Failed:", e2.message);
            return null;
        }
    }
}

async function generateDailySummaryAI(incidents, supportActivities) {
    if (!process.env.GEMINI_API_KEY) return null;

    const dateStr = new Date().toLocaleDateString('en-SG', { day: '2-digit', month: 'long', year: 'numeric' });
    
    const incSummary = incidents.map(i => `[${i.category}] ${i.ai_summary || i.main_content} (Group: ${i.source}) [${i.status}]`).join('\n') || 'No major issues captured.';
    const supportSummary = supportActivities.map(s => `- ${s.name}: ${s.total_attended} incidents attended`).join('\n') || 'No support activity recorded.';

    const prompt = `
    Generate a 24-Hour Executive Summary for the Cloudway Application Support Hub.
    Date: ${dateStr}

    INCIDENT OVERVIEW (LAST 24H):
    ${incSummary}

    SUPPORT TEAM PERFORMANCE:
    ${supportSummary}

    REQUIREMENTS:
    1. Header: 📊 *DAILY SUPPORT HUB EXECUTIVE SUMMARY* 📊
    2. Be professional, concise, and highlight if there were many [PROVIDER_ALERTS] or [SYSTEM_LOGS].
    3. Specifically mention how many incidents were successfully "Attended" by the team.
    4. Provide a "Security/Stability Score" (e.g. 95%).
    5. Formatting: Use Telegram Markdown.
    `;

    try {
        const result = await primaryModel.generateContent(prompt);
        return (await result.response).text();
    } catch (e) {
        console.error("Daily Summary AI fail:", e.message);
        return null;
    }
}

async function addTelegramIncident(groupTitle, senderName, content, msgId, chatId, isSupport = false, replyToMsgId = null) {
    const now = new Date();
    
    // If it's a support member, we primarily want to update an existing incident as "Attended"
    if (isSupport) {
        let incidentToUpdate = null;
        
        // 1. Check if they replied to a specific message that belongs to an incident
        if (replyToMsgId) {
            const update = await db.get(`SELECT incident_id FROM incident_updates WHERE msg_id = ?`, [replyToMsgId]);
            if (update) incidentToUpdate = update.incident_id;
        }
        
        // 2. Fallback: Find the most recent active incident in this specific chat
        if (!incidentToUpdate && chatId) {
            const lastInc = await db.get(
                `SELECT id FROM incidents WHERE source = ? AND status != 'Resolved' ORDER BY last_update DESC LIMIT 1`,
                [groupTitle]
            );
            if (lastInc) incidentToUpdate = lastInc.id;
        }

        if (incidentToUpdate) {
            console.log(`👨‍💻 Support Member [${senderName}] attended incident [${incidentToUpdate}]`);
            await db.run(
                `UPDATE incidents SET status = 'Attended', assigned_to = ?, last_update = ? WHERE id = ?`,
                [senderName, now.toISOString(), incidentToUpdate]
            );
            await db.run(
                `INSERT INTO incident_updates (incident_id, timestamp, sender, content, msg_id, chat_id, is_support) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [incidentToUpdate, now.toISOString(), senderName, content, msgId, chatId ? chatId.toString() : null, 1]
            );
            return; // Handled as attendance, don't create new incident or cluster
        }
    }

    const analysis = await analyzeMessageAI(content);
    
    // Insert into message_analysis_logs (keeping raw log)
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

    let finalCategory = analysis.category;
    if (analysis.isNoise && analysis.confidence > 80) {
        finalCategory = "[NOISE]";
        console.log(`📠 Silent Logging (Noise): ${content.substring(0, 30)}...`);
    }

    const WINDOW_MINUTES = 10;
    const WINDOW_AGO = new Date(now.getTime() - (WINDOW_MINUTES * 60 * 1000)).toISOString();

    // Clustering logic (only for non-support or non-attending messages)
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
                `INSERT INTO incident_updates (incident_id, timestamp, sender, content, msg_id, chat_id, is_support) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [cluster.id, now.toISOString(), senderName, content, msgId, chatId ? chatId.toString() : null, isSupport ? 1 : 0]
            );
            console.log(`🔗 Clustered with incident [${cluster.id}] (${finalCategory})`);
        } else {
            // Create new incident
            const id = Date.now().toString();
            await db.run(
                `INSERT INTO incidents (id, first_timestamp, last_update, category, main_content, ai_summary, status, assigned_to, source, duration_minutes, message_ids, engine)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, now.toISOString(), now.toISOString(), finalCategory, content, analysis.summary || "System Capture", 'Captured', isSupport ? senderName : 'System', groupTitle, 0, JSON.stringify([msgId]), analysis.engine]
            );
            await db.run(
                `INSERT INTO incident_updates (incident_id, timestamp, sender, content, msg_id, chat_id, is_support) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, now.toISOString(), senderName, content, msgId, chatId ? chatId.toString() : null, isSupport ? 1 : 0]
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
            if (!chat || !sender) return;

            const chatId = chat.id.toString();
            const senderId = sender.id.toString();
            const groupTitle = chat.title || (chat.firstName ? chat.firstName : "Private Chat");
            const senderName = (sender.firstName || sender.username || "Unknown");

            // 1. Blacklist Check
            const blacklist = await db.all(`SELECT chat_id FROM blacklisted_chats`);
            if (blacklist.length > 0) {
                const isBlacklisted = blacklist.some(w => String(w.chat_id) === chatId);
                if (isBlacklisted) {
                    // Ignore messages from blacklisted chats
                    return; 
                }
            }

            // 2. Support Member Check
            const supportTeam = await db.all(`SELECT user_id FROM support_members`);
            const isSupport = supportTeam.some(s => String(s.user_id) === senderId);

            console.log(`[${new Date().toLocaleTimeString()}] 📥 MSG from [${groupTitle}] by [${senderName}]${isSupport ? ' (SUPPORT)' : ''}`);

            const content = message.text.trim();
            const msgId = message.id;
            const replyToMsgId = message.replyTo ? message.replyTo.replyToMsgId : null;
            
            // Helpful command to identify User ID
            if (content.toLowerCase() === '/myid') {
                await tgClient.sendMessage(chatId, {
                    message: `📌 Your Telegram User ID is: \`${senderId}\`\n\nUse this ID as ADMIN_TG_ID in your .env file to receive private summaries.`,
                    replyTo: msgId,
                    parseMode: 'markdown'
                });
                return;
            }

            await addTelegramIncident(groupTitle, senderName, content, msgId, chatId, isSupport, replyToMsgId);
        }, new NewMessage({}));

        // --- DYNAMIC CRON INITIALIZATION ---
        await setupShiftPinCron();

        // --- SCHEDULED DAILY SUMMARY (10 AM SG) ---
        cron.schedule('0 10 * * *', async () => {
            const enabled = (await db.get("SELECT config_value FROM system_config WHERE config_key = 'task_summary_enabled'"))?.config_value === '1';
            if (!enabled) return;

            console.log("⏰ 10:00 AM Cron: Generating Daily Summary...");
            try {
                const TWENTY_FOUR_HOURS_AGO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                const incidents = await db.all(`SELECT * FROM incidents WHERE last_update > ?`, [TWENTY_FOUR_HOURS_AGO]);
                const supportTeam = await db.all(`SELECT * FROM support_members`);
                const supportStats = [];
                for (const member of supportTeam) {
                    const attended = await db.get(`SELECT COUNT(*) as count FROM incidents WHERE assigned_to = ? AND last_update > ?`, [member.name, TWENTY_FOUR_HOURS_AGO]);
                    supportStats.push({ name: member.name, total_attended: attended.count });
                }

                const summaryReport = await generateDailySummaryAI(incidents, supportStats);
                
                if (summaryReport && tgClient && tgClient.connected) {
                    const adminId = process.env.ADMIN_TG_ID;
                    if (adminId) {
                        await tgClient.sendMessage(adminId, { message: summaryReport, parseMode: 'markdown' });
                        console.log("✅ Daily Summary sent to Admin.");
                        await dbUpsert('system_config', 'config_key', { config_key: 'task_summary_last_status', config_value: `✅ Success (${new Date().toLocaleTimeString('en-SG')})` });
                    }
                }
            } catch (err) {
                console.error("❌ Cron Summary Failed:", err.message);
                await dbUpsert('system_config', 'config_key', { config_key: 'task_summary_last_status', config_value: `❌ Error (${new Date().toLocaleTimeString('en-SG')})` });
            }
        }, {
            scheduled: true,
            timezone: "Asia/Singapore"
        });

        // --- MANUALLY REMOVED DUPLICATE CRON (IT IS NOW HANDLED BY setupShiftPinCron) ---

        // --- MANUALLY SCHEDULED TASKS CHECKER (Every Minute) ---
        cron.schedule('* * * * *', async () => {
            try {
                const now = new Date();
                const sgNow = new Intl.DateTimeFormat('en-SG', {
                    timeZone: 'Asia/Singapore',
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    hour12: false
                }).format(now);
                
                // Format for MySQL comparison: 'YYYY-MM-DD HH:mm:ss'
                // sgNow is usually 'DD/MM/YYYY, HH:mm:ss'
                const [d, t] = sgNow.split(', ');
                const [dd, mm, yyyy] = d.split('/');
                const mysqlNow = `${yyyy}-${mm}-${dd} ${t}`;

                const pendingTasks = await db.all(
                    "SELECT * FROM manual_scheduled_tasks WHERE status = 'pending' AND scheduled_time <= ?", 
                    [mysqlNow]
                );

                for (const task of pendingTasks) {
                    console.log(`⏰ Executing Scheduled Manual Broadcast: ${task.id}`);
                    try {
                        const chatId = await findChatIdByTitle(task.group_title);
                        if (chatId && tgClient && tgClient.connected) {
                            const sentMsg = await tgClient.sendMessage(chatId, { message: task.message, parseMode: 'markdown' });
                            await tgClient.invoke(new Api.messages.UpdatePinnedMessage({ peer: chatId, id: sentMsg.id, unpin: false }));
                            await db.run("UPDATE manual_scheduled_tasks SET status = 'sent' WHERE id = ?", [task.id]);
                            console.log(`✅ Scheduled task ${task.id} successfully sent.`);
                        } else {
                            throw new Error("Chat not found or TG disconnected");
                        }
                    } catch (taskErr) {
                        console.error(`❌ Scheduled task ${task.id} failed:`, taskErr.message);
                        await db.run("UPDATE manual_scheduled_tasks SET status = 'failed' WHERE id = ?", [task.id]);
                    }
                }
            } catch (err) {
                console.error("❌ Scheduled Checker Failed:", err.message);
            }
        }, {
            scheduled: true,
            timezone: "Asia/Singapore"
        });

        // --- TEST ENDPOINT FOR PIN TASK ---
        app.post('/api/test/trigger-pin-task', async (req, res) => {
            try {
                await runShiftPinTask();
                res.json({ success: true, message: "Pin Task triggered manually" });
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        // --- TEST ENDPOINT FOR SUMMARY ---
        app.post('/api/test-summary', async (req, res) => {
            console.log("🛠️ Manual Trigger: Generating Test Summary...");
            try {
                const TWENTY_FOUR_HOURS_AGO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                const incidents = await db.all(`SELECT * FROM incidents WHERE last_update > ?`, [TWENTY_FOUR_HOURS_AGO]);
                const supportTeam = await db.all(`SELECT * FROM support_members`);
                const supportStats = [];
                for (const member of supportTeam) {
                    const attended = await db.get(`SELECT COUNT(*) as count FROM incidents WHERE assigned_to = ? AND last_update > ?`, [member.name, TWENTY_FOUR_HOURS_AGO]);
                    supportStats.push({ name: member.name, total_attended: attended.count });
                }
                const summaryReport = await generateDailySummaryAI(incidents, supportStats);
                
                if (!summaryReport) {
                    return res.status(400).json({ success: false, error: "AI failed to generate summary (Check GEMINI_API_KEY)" });
                }
                
                if (!tgClient || !tgClient.connected) {
                    return res.status(400).json({ success: false, error: "Telegram Client is NOT connected (Check TG_SESSION)" });
                }

                const adminId = process.env.ADMIN_TG_ID;
                if (!adminId) {
                    return res.status(400).json({ success: false, error: "ADMIN_TG_ID is not set in environment variables" });
                }

                try {
                    await tgClient.sendMessage(adminId, { message: summaryReport, parseMode: 'markdown' });
                    return res.json({ success: true, message: "Summary sent to Admin ID" });
                } catch (sendErr) {
                    return res.status(500).json({ success: false, error: "Telegram Send Failed: " + sendErr.message });
                }
            } catch (err) { 
                console.error("Test Summary Error:", err);
                res.status(500).json({ error: err.message }); 
            }
        });

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
        engine: 'Gemini (Triple Flash)',
        capabilities: ['Real-time Analysis', 'Handover Logic', 'Daily Summaries']
    });
});

// API: TG Diagnostics
app.get('/api/tg-diagnostics', async (req, res) => {
    try {
        const isConnected = tgClient && tgClient.connected;
        let me = null;
        if (isConnected) me = await tgClient.getMe();
        res.json({ connected: !!isConnected, user: me?.username || null });
    } catch (e) { res.json({ connected: false, error: e.message }); }
});

// GET: All Incidents (last 30 days default)
app.get('/api/incidents', async (req, res) => {
    try {
        const rows = await db.all(`SELECT * FROM incidents ORDER BY last_update DESC`);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET: Single Incident Updates
app.get('/api/incidents/:id/updates', async (req, res) => {
    try {
        const rows = await db.all(`SELECT * FROM incident_updates WHERE incident_id = ? ORDER BY timestamp ASC`, [req.params.id]);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST: Resolve Incident
app.post('/api/incidents/:id/resolve', async (req, res) => {
    try {
        await db.run(`UPDATE incidents SET status = 'Resolved', last_update = ? WHERE id = ?`, [new Date().toISOString(), req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: Bulk Resolve
app.post('/api/incidents/bulk-resolve', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: "Invalid IDs" });
        const placeholders = ids.map(() => '?').join(',');
        await db.run(`UPDATE incidents SET status = 'Resolved', last_update = ? WHERE id IN (${placeholders})`, [new Date().toISOString(), ...ids]);
        res.json({ success: true, count: ids.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: Bulk Category Change
app.post('/api/incidents/bulk-categorize', async (req, res) => {
    try {
        const { ids, category } = req.body;
        if (!ids || !category) return res.status(400).json({ error: "Missing data" });
        const placeholders = ids.map(() => '?').join(',');
        await db.run(`UPDATE incidents SET category = ? WHERE id IN (${placeholders})`, [category, ...ids]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Config: Manage Blacklist
app.get('/api/config/blacklist', async (req, res) => {
    try {
        const rows = await db.all(`SELECT * FROM blacklisted_chats`);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config/blacklist', async (req, res) => {
    try {
        const { chat_id, title } = req.body;
        // Upsert style
        const existing = await db.get(`SELECT * FROM blacklisted_chats WHERE chat_id = ?`, [chat_id]);
        if (existing) {
            await db.run(`UPDATE blacklisted_chats SET title = ? WHERE chat_id = ?`, [title, chat_id]);
        } else {
            await db.run(`INSERT INTO blacklisted_chats (chat_id, title) VALUES (?, ?)`, [chat_id, title]);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/config/blacklist/:id', async (req, res) => {
    try {
        await db.run(`DELETE FROM blacklisted_chats WHERE chat_id = ?`, [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Config: Manage Support Team
app.get('/api/config/support-team', async (req, res) => {
    try {
        const rows = await db.all(`SELECT * FROM support_members`);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config/support-team', async (req, res) => {
    try {
        const { user_id, name } = req.body;
        const existing = await db.get(`SELECT * FROM support_members WHERE user_id = ?`, [user_id]);
        if (existing) {
            await db.run(`UPDATE support_members SET name = ? WHERE user_id = ?`, [name, user_id]);
        } else {
            await db.run(`INSERT INTO support_members (user_id, name) VALUES (?, ?)`, [user_id, name]);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/config/support-team/:id', async (req, res) => {
    try {
        await db.run(`DELETE FROM support_members WHERE user_id = ?`, [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Config: Manage Public Holidays
app.get('/api/config/holidays', async (req, res) => {
    try {
        const rows = await db.all(`SELECT * FROM public_holidays ORDER BY holiday_date ASC`);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config/holidays', async (req, res) => {
    try {
        const { holiday_date, name, is_office_closed } = req.body;
        const closedValue = is_office_closed ? 1 : 0;
        const existing = await db.get(`SELECT * FROM public_holidays WHERE holiday_date = ?`, [holiday_date]);
        if (existing) {
            await db.run(`UPDATE public_holidays SET name = ?, is_office_closed = ? WHERE holiday_date = ?`, [name, closedValue, holiday_date]);
        } else {
            await db.run(`INSERT INTO public_holidays (holiday_date, name, is_office_closed) VALUES (?, ?, ?)`, [holiday_date, name, closedValue]);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/config/holidays/:id', async (req, res) => {
    try {
        await db.run(`DELETE FROM public_holidays WHERE id = ?`, [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET: Time Bank Status
app.get('/api/time-bank', async (req, res) => {
    try {
        const rows = await db.all(`SELECT * FROM time_bank`);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// MAINTENANCE: Clear Roster (Keeping Holidays)
app.post('/api/maintenance/reset-roster', async (req, res) => {
    try {
        await db.run(`DELETE FROM roster_shifts`);
        await db.run(`DELETE FROM roster_weeks`);
        await db.run(`DELETE FROM time_bank`);
        res.json({ success: true, message: "Roster data wiped. Holidays preserved." });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: AI Handover Report
app.post('/api/ai-handover', async (req, res) => {
    try {
        const { picName } = req.body;
        // Fetch all non-resolved incidents for today
        const TWENTY_FOUR_HOURS_AGO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const incidents = await db.all(`SELECT * FROM incidents WHERE last_update > ?`, [TWENTY_FOUR_HOURS_AGO]);
        
        const report = await generateHandoverAI(incidents, picName);
        if (!report) return res.status(500).json({ error: "AI failed to generate report" });

        // Auto-Post to TG if possible
        if (tgClient && tgClient.connected) {
            // Find all non-blacklisted chats that we have recorded or known
            const blacklist = await db.all(`SELECT chat_id FROM blacklisted_chats`);
            const blacklistedIds = blacklist.map(b => String(b.chat_id));
            
            // Fetch all recently active chats from logs that aren't blacklisted
            const activeChats = await db.all(`SELECT DISTINCT chat_id FROM message_analysis_logs WHERE chat_id NOT IN (SELECT chat_id FROM blacklisted_chats)`);
            
            for (let chat of activeChats) {
                try {
                    await tgClient.sendMessage(chat.chat_id, { message: report, parseMode: 'markdown' });
                } catch (e) { console.error("Post alert error:", e.message); }
            }
        }

        res.json({ report });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: AI Response Suggestion (Experimental)
app.post('/api/ai-suggest-reply', async (req, res) => {
    try {
        const { incidentId } = req.body;
        const inc = await db.get(`SELECT * FROM incidents WHERE id = ?`, [incidentId]);
        const updates = await db.all(`SELECT * FROM incident_updates WHERE incident_id = ?`, [incidentId]);
        
        const prompt = `
        Incident: ${inc.category} - ${inc.ai_summary || inc.main_content}
        Context: ${updates.slice(-3).map(u => u.content).join(' | ')}
        
        Suggest a professional 1-sentence reply for the support team member to send back to the user/group.
        `;
        
        const result = await primaryModel.generateContent(prompt);
        const replyMsg = (await result.response).text().trim();
        
        // Opt-in: Directly reply in Telegram if we have the msg_id
        if (tgClient && tgClient.connected) {
            const lastUpdate = updates.reverse().find(u => u.msg_id && !u.is_support);
            if (lastUpdate) {
                // We find the most recent non-support message to reply to
                const rows = await db.all(`SELECT msg_id, chat_id FROM incident_updates WHERE incident_id = ? AND is_support = 0 ORDER BY timestamp DESC LIMIT 1`, [incidentId]);
                const update = rows[0];
                if (update.msg_id && update.chat_id) {
                    try {
                        await tgClient.sendMessage(update.chat_id, {
                            message: replyMsg,
                            replyTo: update.msg_id,
                            parseMode: 'markdown'
                        });
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
app.get('/api/roster', async (req, res) => {
    try {
        if (db) {
            const weeks = await db.all("SELECT * FROM roster_weeks ORDER BY id ASC");
            const result = [];
            for (const week of weeks) {
                const shifts = await db.all("SELECT * FROM roster_shifts WHERE week_id = ? ORDER BY day_name, row_index ASC", [week.id]);
                const days = {
                    'Monday': [], 'Tuesday': [], 'Wednesday': [], 'Thursday': [], 'Friday': [], 'Saturday': [], 'Sunday': []
                };
                shifts.forEach(s => {
                    const shiftObj = { time: s.time_slot };
                    if (s.Ivan) shiftObj.Ivan = s.Ivan;
                    if (s.DJ) shiftObj.DJ = s.DJ;
                    if (s.Shawn) shiftObj.Shawn = s.Shawn;
                    if (s.note) shiftObj.note = s.note;
                    if (s.swapped) shiftObj.swapped = true;
                    days[s.day_name].push(shiftObj);
                });
                result.push({ 
                    id: week.id,
                    title: week.title, 
                    dateRange: week.date_range, 
                    days 
                });
            }
            return res.json(result);
        }

        // Fallback to file
        if (!fs.existsSync(ROSTER_FILE)) return res.json([]);
        const rosterData = fs.readFileSync(ROSTER_FILE, 'utf8');
        res.json(JSON.parse(rosterData));
    } catch (e) {
        console.error("Fetch roster error:", e);
        res.status(500).json({ error: "Failed to read roster" });
    }
});

// API: Generate Weekly Roster
app.post('/api/roster/generate', async (req, res) => {
    try {
        const { dateRange, title, early, night, backup } = req.body;
        if (!dateRange || !title || !early || !night || !backup) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const weekDaysData = {};

        days.forEach(day => {
            const isWeekend = day === 'Saturday' || day === 'Sunday';
            if (isWeekend) {
                weekDaysData[day] = [
                    { time: "10:00-01:00", [backup]: "Active (13h)" }
                ];
            } else {
                weekDaysData[day] = [
                    { time: "10:00-19:00", [early]: "✓" },
                    { time: "16:00-01:00", [night]: "✓" },
                    { time: "On-call", [backup]: "Backup" }
                ];
                if (day === 'Wednesday') {
                    weekDaysData[day].push({ 
                        time: "", 
                        Ivan: "IN-OFFICE", 
                        DJ: "IN-OFFICE", 
                        Shawn: "IN-OFFICE", 
                        note: "Weekly Sync Meeting" 
                    });
                } else {
                    weekDaysData[day].push({ time: "", note: "" });
                }
            }
        });

        if (db) {
            // Check if week exists
            const existing = await db.get("SELECT id FROM roster_weeks WHERE date_range = ?", [dateRange]);
            let weekId;
            if (existing) {
                weekId = existing.id;
                await db.run("DELETE FROM roster_shifts WHERE week_id = ?", [weekId]);
                await db.run("UPDATE roster_weeks SET title = ? WHERE id = ?", [title, weekId]);
            } else {
                const { lastID } = await db.run("INSERT INTO roster_weeks (title, date_range) VALUES (?, ?)", [title, dateRange]);
                weekId = lastID;
            }

            for (const day of Object.keys(weekDaysData)) {
                const shifts = weekDaysData[day];
                for (let i = 0; i < shifts.length; i++) {
                    const s = shifts[i];
                    await db.run(`INSERT INTO roster_shifts 
                        (week_id, day_name, row_index, time_slot, Ivan, DJ, Shawn, note, swapped) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
                        [weekId, day, i, s.time || '', s.Ivan || null, s.DJ || null, s.Shawn || null, s.note || null, 0]
                    );
                }
            }
            return res.json({ success: true, message: "Weekly roster generated in Database" });
        }

        // Fallback to file logic
        let roster = [];
        if (fs.existsSync(ROSTER_FILE)) {
            try { const raw = fs.readFileSync(ROSTER_FILE, 'utf8'); roster = JSON.parse(raw); } catch (pErr) { roster = []; }
        }
        const newWeek = { title, dateRange, days: weekDaysData };
        const idx = roster.findIndex(w => w.dateRange === dateRange);
        if (idx !== -1) roster[idx] = newWeek; else roster.push(newWeek);
        fs.writeFileSync(ROSTER_FILE, JSON.stringify(roster, null, 2));
        res.json({ success: true, message: "Weekly roster generated in file" });

    } catch (e) {
        console.error("Roster Generation Error:", e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/roster/swap', async (req, res) => {
    try {
        const { day, rowIndex, currentPIC, weekTitle, reason, replacementPIC } = req.body;

        if (db) {
            const week = await db.get("SELECT id FROM roster_weeks WHERE title = ?", [weekTitle]);
            if (!week) return res.status(404).json({ error: "Week not found" });

            const shifts = await db.all("SELECT * FROM roster_shifts WHERE week_id = ? AND day_name = ? ORDER BY row_index ASC", [week.id, day]);
            const target = shifts[rowIndex];
            if (!target) return res.status(404).json({ error: "Shift not found" });

            // Swap personnel
            const status = target[currentPIC] || '✓';
            await db.run(`UPDATE roster_shifts SET ${currentPIC} = NULL, ${replacementPIC} = ?, swapped = 1 WHERE id = ?`, [status, target.id]);

            // Handle Remark row (usually row 4 / index 3)
            if (reason === 'AL' || reason === 'MC') {
                const remarkText = `${currentPIC}: ${reason}`;
                let remarkRow = shifts[3]; // Row 4
                if (!remarkRow) {
                    const { lastID } = await db.run("INSERT INTO roster_shifts (week_id, day_name, row_index, time_slot, note) VALUES (?, ?, 3, '', ?)", [week.id, day, remarkText]);
                } else {
                    const existingNote = remarkRow.note || '';
                    const newNote = existingNote ? `${existingNote} / ${remarkText}` : remarkText;
                    if (!existingNote.includes(remarkText)) {
                        await db.run("UPDATE roster_shifts SET note = ? WHERE id = ?", [newNote, remarkRow.id]);
                    }
                }
            }
            return res.json({ success: true });
        }

        // Fallback to file
        if (!fs.existsSync(ROSTER_FILE)) return res.status(404).json({ error: "Roster not found" });
        const roster = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8'));
        const week = roster.find(w => w.title === weekTitle);
        if (!week || !week.days[day]) return res.status(404).json({ error: "Day not found" });
        const dayShifts = week.days[day];
        const targetShift = dayShifts[rowIndex];
        if (!targetShift) return res.status(404).json({ error: "Shift not found" });

        const oldStatus = targetShift[currentPIC] || '✓';
        delete targetShift[currentPIC];
        targetShift[replacementPIC] = oldStatus;
        targetShift.swapped = true; 

        if (reason === 'AL' || reason === 'MC') {
            const remarkText = `${currentPIC}: ${reason}`;
            while (dayShifts.length < 4) dayShifts.push({ time: "" });
            const remarkShift = dayShifts[3];
            if (remarkShift) {
                const currentNote = remarkShift.note || '';
                remarkShift.note = currentNote ? (currentNote.includes(remarkText) ? currentNote : `${currentNote} / ${remarkText}`) : remarkText;
            }
        }
        fs.writeFileSync(ROSTER_FILE, JSON.stringify(roster, null, 2));
        res.json({ success: true });

    } catch (e) {
        console.error("Swap Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// API: Delete Roster Week
app.delete('/api/roster/week/:id', async (req, res) => {
    try {
        const weekId = req.params.id;
        if (db) {
            await db.run("DELETE FROM roster_shifts WHERE week_id = ?", [weekId]);
            await db.run("DELETE FROM roster_weeks WHERE id = ?", [weekId]);
            return res.json({ success: true });
        }
        
        // File fallback
        if (fs.existsSync(ROSTER_FILE)) {
            let roster = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8'));
            // Note: For file fallback, 'id' might be index or we check title
            // But since we migrated to DB, this is mainly for safety
            roster = roster.filter((w, idx) => (w.id || idx).toString() !== weekId);
            fs.writeFileSync(ROSTER_FILE, JSON.stringify(roster, null, 2));
            return res.json({ success: true });
        }
        res.status(404).json({ error: "Not found" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/test/pin-message', async (req, res) => {
    try {
        if (!tgClient || !tgClient.connected) {
            return res.status(503).json({ error: "Telegram client not connected" });
        }

        const { title, message } = req.body;
        if (!title || !message) {
            return res.status(400).json({ error: "Title and message are required" });
        }

        const dialogs = await tgClient.getDialogs();
        const targetChat = dialogs.find(d => d.title && d.title.includes(title));

        if (!targetChat) {
            return res.status(404).json({ error: `Could not find chat with title: ${title}` });
        }

        const chatId = targetChat.id;
        const sentMsg = await tgClient.sendMessage(chatId, { message });

        await tgClient.invoke(
            new Api.messages.UpdatePinnedMessage({
                peer: chatId,
                id: sentMsg.id,
                unpin: false,
                pmOneSide: false,
            })
        );

        res.json({ success: true, message: "Message sent and pinned", chatId: chatId.toString() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});



// --- Pin Task Helpers ---
let activePinCronJob = null;

async function setupShiftPinCron() {
    try {
        if (activePinCronJob) {
            activePinCronJob.stop();
            console.log("🛑 Existing Shift Pin Cron stopped.");
        }

        // 1. Get schedule from DB, fallback to 10 AM
        let scheduleRecord = await db.get("SELECT config_value FROM system_config WHERE config_key = 'shift_pin_cron'");
        if (!scheduleRecord) {
            const defaultCron = '0 10 * * *';
            await db.run("INSERT INTO system_config (config_key, config_value) VALUES (?, ?)", ['shift_pin_cron', defaultCron]);
            scheduleRecord = { config_value: defaultCron };
        }

        activePinCronJob = cron.schedule(scheduleRecord.config_value, async () => {
            const enabled = (await db.get("SELECT config_value FROM system_config WHERE config_key = 'task_shift_pin_enabled'"))?.config_value !== '0';
            if (!enabled) return;
            
            console.log(`⏰ Scheduled Automation Trigger [${scheduleRecord.config_value}]: Starting Shift Pin Task...`);
            await runShiftPinTask();
        }, {
            scheduled: true,
            timezone: "Asia/Singapore"
        });

        console.log(`✅ Shift Pin Automation Scheduled: [${scheduleRecord.config_value}]`);
    } catch (e) {
        console.error("❌ Failed to setup dynamic cron:", e.message);
    }
}

function isCurrentWeek(dateRange) {
    if (!dateRange || !dateRange.includes('-')) return false;
    try {
        const [startPart, endPart] = dateRange.split('-');
        const currentYear = new Date().getFullYear();
        
        const parseDate = (str) => {
            const day = parseInt(str.substring(0, 2));
            const monthStr = str.substring(2);
            const months = { 'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5, 'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11 };
            return new Date(currentYear, months[monthStr], day);
        };

        const start = parseDate(startPart);
        const end = parseDate(endPart);
        end.setHours(23, 59, 59, 999);
        
        const sgTime = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        const now = new Date(sgTime);
        return now >= start && now <= end;
    } catch (e) {
        return false;
    }
}

// Helper for Preview Content
async function generateShiftPinContent() {
    const now = new Date();
    const sgNowString = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Singapore',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).format(now);
    
    const parts = sgNowString.split(', ');
    const dateParts = parts[0].split('/');
    const timeParts = parts[1].split(':');
    const sgNow = new Date(dateParts[2], dateParts[0]-1, dateParts[1], timeParts[0], timeParts[1], timeParts[2]);

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const todayName = dayNames[sgNow.getDay()];
    const dateStr = `${sgNow.getDate()}/${sgNow.getMonth() + 1}`;

    const weeks = await db.all("SELECT * FROM roster_weeks");
    let activeWeekId = null;
    for (const week of weeks) {
        if (isCurrentWeek(week.date_range)) {
            activeWeekId = week.id;
            break;
        }
    }
    if (!activeWeekId) return `⚠️ No active roster week found for ${dateStr}.`;

    const shifts = await db.all("SELECT * FROM roster_shifts WHERE week_id = ? AND day_name = ? ORDER BY row_index ASC", [activeWeekId, todayName]);
    if (shifts.length === 0) return `⚠️ No shifts found for ${todayName}.`;

    const shiftParts = [];
    shifts.forEach(s => {
        const pic = s.Ivan ? 'Ivan' : (s.DJ ? 'DJ' : (s.Shawn ? 'Shawn' : null));
        if (pic && s.time_slot && !['OFF', 'Rest Day', 'Backup'].includes(s.time_slot)) {
            let formattedTime = s.time_slot.replace(/:00/g, '').replace(/10/g, '10am').replace(/19/g, '7pm').replace(/16/g, '4pm').replace(/01/g, '1am').replace(/21/g, '9pm');
            shiftParts.push(`${pic} ${formattedTime}`);
        }
    });

    if (shiftParts.length === 0) return `⚠️ No active PICs found for today.`;
    return `📌 ${dateStr} PIC : ${shiftParts.join(' | ')}`;
}

async function dbUpsert(table, matchKey, data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map(() => '?').join(', ');
    
    if (db.isMySQL) {
        const updateStr = keys.map(k => `\`${k}\` = VALUES(\`${k}\`)`).join(', ');
        const sql = `INSERT INTO ${table} (${keys.map(k => `\`${k}\``).join(', ')}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updateStr}`;
        return await db.run(sql, values);
    } else {
        const updateStr = keys.map(k => `${k} = excluded.${k}`).join(', ');
        const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders}) ON CONFLICT(${matchKey}) DO UPDATE SET ${updateStr}`;
        return await db.run(sql, values);
    }
}

async function runShiftPinTask() {
    console.log("🛠️ Starting runShiftPinTask...");
    try {
        const sgNowString = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Singapore',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        }).format(new Date());
        
        // formats usually as MM/DD/YYYY, HH:mm:ss
        const parts = sgNowString.split(', ');
        const dateParts = parts[0].split('/');
        const timeParts = parts[1].split(':');
        
        const now = new Date(dateParts[2], dateParts[0]-1, dateParts[1], timeParts[0], timeParts[1], timeParts[2]);
        
        if (!tgClient || !tgClient.connected) {
            const errMsg = `❌ Failed (Telegram Disconnected at ${now.toLocaleTimeString()})`;
            await db.run("INSERT INTO system_config (config_key, config_value) VALUES ('shift_pin_last_status', ?) ON CONFLICT(config_key) DO UPDATE SET config_value = excluded.config_value", [errMsg]);
            return;
        }

        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const todayName = dayNames[now.getDay()];
        const dateStr = `${now.getDate()}/${now.getMonth() + 1}`;

        // Find current week roster
        const weeks = await db.all("SELECT * FROM roster_weeks");
        let activeWeekId = null;
        for (const week of weeks) {
            if (isCurrentWeek(week.date_range)) {
                activeWeekId = week.id;
                break;
            }
        }

        if (!activeWeekId) {
            console.warn(`⚠️ No active roster week found matching today's date (${dateStr}).`);
            return;
        }

        const shifts = await db.all(
            "SELECT * FROM roster_shifts WHERE week_id = ? AND day_name = ? ORDER BY row_index ASC", 
            [activeWeekId, todayName]
        );

        if (shifts.length === 0) return;

        // Construct shift text
        const shiftParts = [];
        shifts.forEach(s => {
            const pic = s.Ivan ? 'Ivan' : (s.DJ ? 'DJ' : (s.Shawn ? 'Shawn' : null));
            if (pic && s.time_slot && s.time_slot !== 'OFF' && s.time_slot !== 'Rest Day' && s.time_slot !== 'Backup') {
                let formattedTime = s.time_slot.replace(/:00/g, '');
                formattedTime = formattedTime.replace(/10/g, '10am').replace(/19/g, '7pm').replace(/16/g, '4pm').replace(/01/g, '1am').replace(/21/g, '9pm');
                shiftParts.push(`${pic} ${formattedTime}`);
            }
        });

        if (shiftParts.length === 0) return;

        const pinMessage = `📌 ${dateStr} PIC : ${shiftParts.join(' | ')}`;
        
        // Target Group from DB
        let targetConfig = await db.get("SELECT config_value FROM system_config WHERE config_key = 'shift_pin_target_chat'");
        if (!targetConfig) {
            const defaultTarget = "CW App Int Group";
            await db.run("INSERT INTO system_config (config_key, config_value) VALUES (?, ?)", ['shift_pin_target_chat', defaultTarget]);
            targetConfig = { config_value: defaultTarget };
        }
        const targetTitle = targetConfig.config_value;

        const dialogs = await tgClient.getDialogs();
        const targetChat = dialogs.find(d => d.title && d.title.includes(targetTitle));

        if (!targetChat) {
            const errMsg = `❌ Group "${targetTitle}" Not Found`;
            await db.run("INSERT INTO system_config (config_key, config_value) VALUES ('shift_pin_last_status', ?) ON CONFLICT(config_key) DO UPDATE SET config_value = excluded.config_value", [errMsg]);
            return;
        }

        const chatId = targetChat.id;

        // Cleanup old pin
        const oldPin = await db.get("SELECT * FROM tg_pins WHERE chat_title = ?", [targetTitle]);
        if (oldPin && oldPin.msg_id) {
            try {
                await tgClient.invoke(new Api.messages.UpdatePinnedMessage({ peer: oldPin.chat_id, id: parseInt(oldPin.msg_id), unpin: true }));
                await tgClient.invoke(new Api.messages.DeleteMessages({ peer: oldPin.chat_id, id: [parseInt(oldPin.msg_id)], revoke: true }));
            } catch (err) {}
        }

        // Send New
        const sentMsg = await tgClient.sendMessage(chatId, {
            message: pinMessage,
            parseMode: 'markdown',
            buttons: [
                new Api.KeyboardButtonUrl({ 
                    text: "📅 View Full Roster", 
                    url: process.env.HUB_URL || "https://appsuphub.up.railway.app/" 
                })
            ]
        });

        // Pin New
        await tgClient.invoke(new Api.messages.UpdatePinnedMessage({ peer: chatId, id: sentMsg.id, unpin: false }));

        // Store new state
        await dbUpsert('tg_pins', 'chat_title', { chat_title: targetTitle, msg_id: sentMsg.id, chat_id: chatId.toString() });

        const statusMsg = `✅ Success (Pinned at ${new Date().toLocaleTimeString('en-SG')})`;
        await dbUpsert('system_config', 'config_key', { config_key: 'shift_pin_last_status', config_value: statusMsg });

        console.log(`✅ Automated shift pin successful for [${targetTitle}].`);

    } catch (e) {
        console.error("❌ Critical Failure in runShiftPinTask:", e);
        const errMsg = `❌ Error: ${e.message.substring(0, 50)}`;
        await dbUpsert('system_config', 'config_key', { config_key: 'shift_pin_last_status', config_value: errMsg });
    }
}

// API: Config Endpoints
app.get('/api/config/shift-pin', async (req, res) => {
    try {
        const cronStr = (await db.get("SELECT config_value FROM system_config WHERE config_key = 'shift_pin_cron'"))?.config_value || '0 10 * * *';
        const target = (await db.get("SELECT config_value FROM system_config WHERE config_key = 'shift_pin_target_chat'"))?.config_value || 'CW App Int Group';
        const status = (await db.get("SELECT config_value FROM system_config WHERE config_key = 'shift_pin_last_status'"))?.config_value || 'Idle';
        
        // Parse cron for UI (Assuming format 0 H * * *)
        const hour = cronStr.split(' ')[1] || '10';
        res.json({ cron: cronStr, hour, target, lastStatus: status });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config/shift-pin', async (req, res) => {
    try {
        const { hour, target } = req.body;
        if (!hour || !target) return res.status(400).json({ error: "Missing parameters" });
        
        const cronStr = `0 ${hour} * * *`;
        await dbUpsert('system_config', 'config_key', { config_key: 'shift_pin_cron', config_value: cronStr });
        await dbUpsert('system_config', 'config_key', { config_key: 'shift_pin_target_chat', config_value: target });
        
        await setupShiftPinCron();
        res.json({ success: true, message: "Settings updated and Cron rescheduled." });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- AUTOMATION HUB API ---
app.get('/api/automation/tasks', async (req, res) => {
    try {
        const showHidden = req.query.showHidden === 'true';
        const rawTasks = [
            { id: 'shift_pin', name: 'Daily Shift Pinning' },
            { id: 'daily_summary', name: 'Daily Activity Summary' }
        ];

        const tasks = [];
        for (const t of rawTasks) {
            const hidden = (await db.get("SELECT config_value FROM system_config WHERE config_key = ?", [`task_${t.id}_hidden`]))?.config_value === '1';
            if (hidden && !showHidden) continue;

            tasks.push({
                ...t,
                schedule: (await db.get("SELECT config_value FROM system_config WHERE config_key = ?", [t.id === 'shift_pin' ? 'shift_pin_cron' : 'task_summary_cron']))?.config_value || '0 10 * * *',
                lastStatus: (await db.get("SELECT config_value FROM system_config WHERE config_key = ?", [t.id === 'shift_pin' ? 'shift_pin_last_status' : 'task_summary_last_status']))?.config_value || 'Idle',
                enabled: (await db.get("SELECT config_value FROM system_config WHERE config_key = ?", [t.id === 'shift_pin' ? 'task_shift_pin_enabled' : 'task_summary_enabled']))?.config_value === '1',
                hidden
            });
        }
        res.json(tasks);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/automation/toggle', async (req, res) => {
    try {
        const { taskId, enabled } = req.body;
        const configKey = taskId === 'shift_pin' ? 'task_shift_pin_enabled' : 'task_summary_enabled';
        await dbUpsert('system_config', 'config_key', { config_key: configKey, config_value: enabled ? '1' : '0' });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/automation/archive', async (req, res) => {
    try {
        const { taskId, archive } = req.body;
        const configKey = `task_${taskId}_hidden`;
        await dbUpsert('system_config', 'config_key', { config_key: configKey, config_value: archive ? '1' : '0' });
        
        // Auto-disable if archiving
        if (archive) {
            const enabledKey = taskId === 'shift_pin' ? 'task_shift_pin_enabled' : 'task_summary_enabled';
            await dbUpsert('system_config', 'config_key', { config_key: enabledKey, config_value: '0' });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/automation/schedule', async (req, res) => {
    try {
        const { taskId, hour } = req.body;
        const cronStr = `0 ${hour} * * *`;
        const configKey = taskId === 'shift_pin' ? 'shift_pin_cron' : 'task_summary_cron';
        await dbUpsert('system_config', 'config_key', { config_key: configKey, config_value: cronStr });
        
        if (taskId === 'shift_pin') {
            await setupShiftPinCron();
        } else {
            // Need to reschedule daily summary too
            // Note: This would involve making the summary cron dynamic too
            // For now, let's keep it simple and just update the DB
            console.log(`⏰ Schedule for ${taskId} updated to ${cronStr}`);
        }
        res.json({ success: true, message: `Schedule for ${taskId} updated.` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/automation/preview/:taskId', async (req, res) => {
    try {
        const { taskId } = req.params;
        if (taskId === 'shift_pin') {
            const content = await generateShiftPinContent();
            return res.json({ content });
        } else if (taskId === 'daily_summary') {
            // Dry run for summary
            const TWENTY_FOUR_HOURS_AGO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const incidents = await db.all(`SELECT * FROM incidents WHERE last_update > ?`, [TWENTY_FOUR_HOURS_AGO]);
            const supportTeam = await db.all(`SELECT * FROM support_members`);
            const supportStats = [];
            for (const member of supportTeam) {
                const attended = await db.get(`SELECT COUNT(*) as count FROM incidents WHERE assigned_to = ? AND last_update > ?`, [member.name, TWENTY_FOUR_HOURS_AGO]);
                supportStats.push({ name: member.name, total_attended: attended.count });
            }
            const content = await generateDailySummaryAI(incidents, supportStats);
            return res.json({ content });
        }
        res.status(404).json({ error: "Task not found" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/manual/schedule', async (req, res) => {
    try {
        const { title, message, scheduledTime } = req.body;
        if (!title || !message) return res.status(400).json({ error: "Missing title or message" });

        if (!scheduledTime) {
            // IMMEDIATE SEND
            const chatId = await findChatIdByTitle(title);
            if (!chatId) return res.status(404).json({ error: "Target group not found by bot." });

            const sentMsg = await tgClient.sendMessage(chatId, { message, parseMode: 'markdown' });
            await tgClient.invoke(new Api.messages.UpdatePinnedMessage({ peer: chatId, id: sentMsg.id, unpin: false }));
            return res.json({ success: true, immediate: true });
        } else {
            // SCHEDULED SEND
            await db.run(
                "INSERT INTO manual_scheduled_tasks (group_title, message, scheduled_time) VALUES (?, ?, ?)",
                [title, message, scheduledTime]
            );
            res.json({ success: true, immediate: false });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Fallback to index.html for unknown routes (SPA style)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 App Support Hub running at http://localhost:${PORT}`);
});
