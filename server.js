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
                    time_slot VARCHAR(100),
                    person_name VARCHAR(100),
                    shift_status VARCHAR(255),
                    INDEX(week_id),
                    INDEX(day_name)
                );
                CREATE TABLE IF NOT EXISTS whitelisted_chats (
                    chat_id VARCHAR(255) PRIMARY KEY,
                    title VARCHAR(255)
                );
                CREATE TABLE IF NOT EXISTS support_members (
                    user_id VARCHAR(255) PRIMARY KEY,
                    name VARCHAR(255)
                );
                -- Ensure column is there for existing setups
                ALTER TABLE incident_updates ADD COLUMN is_support BOOLEAN DEFAULT FALSE;
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
            CREATE TABLE IF NOT EXISTS whitelisted_chats (
                chat_id TEXT PRIMARY KEY,
                title TEXT
            );
            CREATE TABLE IF NOT EXISTS support_members (
                user_id TEXT PRIMARY KEY,
                name TEXT
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

            // 1. Whitelist Check
            const whitelist = await db.all(`SELECT chat_id FROM whitelisted_chats`);
            if (whitelist.length > 0) {
                const isWhitelisted = whitelist.some(w => String(w.chat_id) === chatId);
                if (!isWhitelisted) {
                    // Optional: Log once per chat to avoid spamming console
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

        // --- SCHEDULED DAILY SUMMARY (10 AM) ---
        cron.schedule('0 10 * * *', async () => {
            console.log("⏰ 10:00 AM Cron: Generating Daily Summary...");
            try {
                const TWENTY_FOUR_HOURS_AGO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                
                // Fetch recent incidents
                const incidents = await db.all(`SELECT * FROM incidents WHERE last_update > ?`, [TWENTY_FOUR_HOURS_AGO]);
                
                // Fetch support stats
                const supportTeam = await db.all(`SELECT * FROM support_members`);
                const supportStats = [];
                for (const member of supportTeam) {
                    const attended = await db.get(`SELECT COUNT(*) as count FROM incidents WHERE assigned_to = ? AND last_update > ?`, [member.name, TWENTY_FOUR_HOURS_AGO]);
                    supportStats.push({ name: member.name, total_attended: attended.count });
                }

                const summaryReport = await generateDailySummaryAI(incidents, supportStats);
                
                if (summaryReport && tgClient && tgClient.connected) {
                    // Send to specific Admin ID if defined, otherwise send to all whitelisted chats as a fallback report
                    const adminId = process.env.ADMIN_TG_ID;
                    if (adminId) {
                        await tgClient.sendMessage(adminId, { message: summaryReport, parseMode: 'markdown' });
                        console.log("✅ Daily Summary sent to Admin.");
                    } else {
                        // If no Admin ID, send to first whitelisted chat as a broadcast
                        const whitelist = await db.all(`SELECT chat_id FROM whitelisted_chats LIMIT 1`);
                        if (whitelist.length > 0) {
                            await tgClient.sendMessage(whitelist[0].chat_id, { message: summaryReport, parseMode: 'markdown' });
                            console.log("✅ Daily Summary broadcast to first whitelisted chat.");
                        }
                    }
                }
            } catch (err) {
                console.error("❌ Cron Summary Failed:", err.message);
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

// Config: Manage Whitelist
app.get('/api/config/whitelist', async (req, res) => {
    try {
        const rows = await db.all(`SELECT * FROM whitelisted_chats`);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config/whitelist', async (req, res) => {
    try {
        const { chat_id, title } = req.body;
        // Upsert style
        const existing = await db.get(`SELECT * FROM whitelisted_chats WHERE chat_id = ?`, [chat_id]);
        if (existing) {
            await db.run(`UPDATE whitelisted_chats SET title = ? WHERE chat_id = ?`, [title, chat_id]);
        } else {
            await db.run(`INSERT INTO whitelisted_chats (chat_id, title) VALUES (?, ?)`, [chat_id, title]);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/config/whitelist/:id', async (req, res) => {
    try {
        await db.run(`DELETE FROM whitelisted_chats WHERE chat_id = ?`, [req.params.id]);
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
            // Find UFABET group or common support group
            const whitelist = await db.all(`SELECT chat_id FROM whitelisted_chats`);
            for (let chat of whitelist) {
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
