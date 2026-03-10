const express = require('express');
const path = require('path');
const fs = require('fs');
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const app = express();
app.use(express.json());

const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Database Initialization
let db;
(async () => {
    db = await open({
        filename: path.join(__dirname, 'hub_storage.db'),
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
            message_ids TEXT
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
    `);
    console.log("✅ SQLite Database initialized with AI ready schema.");
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
    if (!process.env.GEMINI_API_KEY) {
        return { category: categorizeIncident(content), summary: content, isNoise: false };
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
        return JSON.parse(text);
    } catch (e) {
        console.error("AI Analysis Failed:", e);
        return { category: categorizeIncident(content), summary: content, isNoise: false };
    }
}

async function addTelegramIncident(groupTitle, senderName, content, msgId, chatId) {
    const analysis = await analyzeMessageAI(content);
    
    if (analysis.isNoise && analysis.confidence > 80) {
        console.log(`🗑️ Noise filtered: ${content.substring(0, 30)}...`);
        return;
    }

    const now = new Date();
    const WINDOW_MINUTES = 10;
    const WINDOW_AGO = new Date(now.getTime() - (WINDOW_MINUTES * 60 * 1000)).toISOString();

    // Check for existing incident in the last 10 minutes from SAME group/source
    const cluster = await db.get(
        `SELECT id, main_content FROM incidents 
         WHERE category = ? AND last_update > ? AND status != 'Resolved'
         ORDER BY last_update DESC LIMIT 1`,
        [analysis.category, WINDOW_AGO]
    );

    if (cluster) {
        // AI check for semantic similarity if needed, but time-window + category is strong
        // Update existing cluster
        console.log(`🔗 Clustered with incident [${cluster.id}]`);
        await db.run(
            `INSERT INTO incident_updates (incident_id, timestamp, sender, content, msg_id, chat_id) VALUES (?, ?, ?, ?, ?, ?)`,
            [cluster.id, now.toISOString(), senderName, content, msgId, chatId.toString()]
        );
        
        // Update summary if it's the 5th message or something, or just update timestamp
        await db.run(
            `UPDATE incidents SET last_update = ?, status = 'In Progress' WHERE id = ?`,
            [now.toISOString(), cluster.id]
        );
    } else {
        // Create new incident
        const id = Date.now().toString();
        await db.run(
            `INSERT INTO incidents (id, first_timestamp, last_update, category, main_content, ai_summary, status, assigned_to, source, duration_minutes, message_ids)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, now.toISOString(), now.toISOString(), analysis.category, content, analysis.summary, 'Captured', 'Pending Review', groupTitle, 0, JSON.stringify([msgId])]
        );
        await db.run(
            `INSERT INTO incident_updates (incident_id, timestamp, sender, content, msg_id, chat_id) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, now.toISOString(), senderName, content, msgId, chatId.toString()]
        );
    }

    // RETENTION: Cleanup incidents older than 90 days
    const NINETY_DAYS_AGO = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000)).toISOString();
    await db.run(`DELETE FROM incident_updates WHERE incident_id IN (SELECT id FROM incidents WHERE last_update < ?)`, [NINETY_DAYS_AGO]);
    await db.run(`DELETE FROM incidents WHERE last_update < ?`, [NINETY_DAYS_AGO]);
}

// Telegram Passive Listener
async function initTelegram() {
    tgClient = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });
    await tgClient.connect();
    console.log("✅ Connected to Telegram as user.");

    tgClient.addEventHandler(async (event) => {
        const message = event.message;
        if (!message || !message.text) return;
        const chat = await message.getChat();
        const sender = await message.getSender();

        if (chat instanceof Api.Chat || chat instanceof Api.Channel) {
            const groupTitle = chat.title || "Unknown Group";
            const senderName = sender ? (sender.firstName || sender.username || "Unknown") : "Unknown";
            const content = message.text.trim();
            const msgId = message.id;
            const chatId = chat.id;
            
            console.log(`📩 Auto-captured from [${groupTitle}] by [${senderName}]: ${content.substring(0, 50)}...`);
            await addTelegramIncident(groupTitle, senderName, content, msgId, chatId);
        }
    }, new NewMessage({}));
}
initTelegram();

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

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
        // Attach updates to each incident
        for (let inc of incidents) {
            inc.updates = await db.all(`SELECT * FROM incident_updates WHERE incident_id = ? ORDER BY timestamp ASC`, [inc.id]);
        }
        res.json(incidents);
    } catch (e) { res.status(500).json({ error: e.message }); }
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
            `INSERT INTO incidents (id, first_timestamp, last_update, category, main_content, ai_summary, status, assigned_to, source, duration_minutes, message_ids)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, now.toISOString(), now.toISOString(), analysis.category, content, analysis.summary, 'Active', assigned_to || 'Unassigned', 'Manual Input', 0, "[]"]
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
