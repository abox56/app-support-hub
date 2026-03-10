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
            status TEXT,
            assigned_to TEXT,
            source TEXT,
            duration_minutes INTEGER
        );
        CREATE TABLE IF NOT EXISTS incident_updates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            incident_id TEXT,
            timestamp TEXT,
            sender TEXT,
            content TEXT,
            FOREIGN KEY(incident_id) REFERENCES incidents(id)
        );
    `);
    console.log("✅ SQLite Database initialized.");
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
async function addTelegramIncident(groupTitle, senderName, content) {
    const category = categorizeIncident(content);
    const now = new Date();
    const TWO_HOURS_AGO = new Date(now.getTime() - (2 * 60 * 60 * 1000)).toISOString();

    // Check for existing incident in the last 2 hours
    const existing = await db.get(
        `SELECT id FROM incidents 
         WHERE source = ? AND category = ? AND last_update > ? AND status != 'Resolved'
         LIMIT 1`,
        [groupTitle, category, TWO_HOURS_AGO]
    );

    if (existing) {
        // Update existing thread
        await db.run(
            `INSERT INTO incident_updates (incident_id, timestamp, sender, content) VALUES (?, ?, ?, ?)`,
            [existing.id, now.toISOString(), senderName, content]
        );
        await db.run(
            `UPDATE incidents SET last_update = ?, status = 'In Progress' WHERE id = ?`,
            [now.toISOString(), existing.id]
        );
    } else {
        // Create new incident
        const id = Date.now().toString();
        await db.run(
            `INSERT INTO incidents (id, first_timestamp, last_update, category, main_content, status, assigned_to, source, duration_minutes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, now.toISOString(), now.toISOString(), category, content, 'Captured', 'Pending Review', groupTitle, 0]
        );
        await db.run(
            `INSERT INTO incident_updates (incident_id, timestamp, sender, content) VALUES (?, ?, ?, ?)`,
            [id, now.toISOString(), senderName, content]
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
            
            console.log(`📩 Auto-captured from [${groupTitle}] by [${senderName}]: ${content.substring(0, 50)}...`);
            await addTelegramIncident(groupTitle, senderName, content);
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
    try {
        await db.run(
            `INSERT INTO incidents (id, first_timestamp, last_update, category, main_content, status, assigned_to, source, duration_minutes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, now.toISOString(), now.toISOString(), categorizeIncident(content), content, 'Active', assigned_to || 'Unassigned', 'Manual Input', 0]
        );
        await db.run(
            `INSERT INTO incident_updates (incident_id, timestamp, sender, content) VALUES (?, ?, ?, ?)`,
            [id, now.toISOString(), assigned_to || 'System', content]
        );
        res.json({ id, success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Roster Database Helpers
const ROSTER_FILE = path.join(__dirname, 'roster.json');

function readRoster() {
    try {
        if (!fs.existsSync(ROSTER_FILE)) {
            const defaultRoster = [
                {
                    rowLabel: "Early",
                    timeLabel: "10am - 6pm",
                    shifts: ["Ivan", "Shawn", "NO LEAVE<br/>KNOWLEDGE UPGRADE", "DJ", "Ivan", "-", "-"]
                },
                {
                    rowLabel: "Late",
                    timeLabel: "6pm - 1am",
                    shifts: ["DJ", "Ivan", "Shawn", "Ivan", "DJ", "-", "-"]
                },
                {
                    rowLabel: "Utility / Wkend",
                    timeLabel: "",
                    shifts: ["Shawn", "DJ", "Ivan", "Shawn", "Shawn", "DJ", "Ivan"]
                }
            ];
            writeRoster(defaultRoster);
            return defaultRoster;
        }
        return JSON.parse(fs.readFileSync(ROSTER_FILE));
    } catch (e) { return []; }
}

function writeRoster(data) {
    fs.writeFileSync(ROSTER_FILE, JSON.stringify(data, null, 2));
}

// API: Get roster
app.get('/api/roster', (req, res) => {
    res.json(readRoster());
});

// API: Update roster
app.post('/api/roster', (req, res) => {
    writeRoster(req.body);
    res.json({ success: true, message: "Roster updated successfully" });
});

// Fallback to index.html for unknown routes (SPA style)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 App Support Hub running at http://localhost:${PORT}`);
});
