const express = require('express');
const path = require('path');
const fs = require('fs');
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8000;
const HUB_PASSWORD = process.env.HUB_PASSWORD || "Cloudway2026!";

// Middleware to check for authentication
app.use((req, res, next) => {
    // We allow static files to be served, but gate the API data
    if (req.path.startsWith('/api/')) {
        const clientKey = req.headers['authorization'];
        if (clientKey !== HUB_PASSWORD) {
            return res.status(401).json({ error: "Unauthorized: Invalid HUB_PASSWORD" });
        }
    }
    next();
});

// Telegram Configuration
const apiId = parseInt(process.env.TG_API_ID || "36039479");
const apiHash = process.env.TG_API_HASH || "cbb4b1ed8cf7605931c48a56140366d7";
const stringSession = new StringSession(process.env.TG_SESSION || "");

let tgClient;

async function initTelegram() {
    tgClient = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });
    await tgClient.connect();
    console.log("✅ Connected to Telegram as user.");

    // Passive Listener for Group Events
    tgClient.addEventHandler(async (event) => {
        const message = event.message;
        if (!message || !message.text) return;

        const chat = await message.getChat();
        const sender = await message.getSender();

        if (chat instanceof Api.Chat || chat instanceof Api.Channel) {
            const groupTitle = chat.title || "Unknown Group";
            const senderName = sender ? (sender.firstName || sender.username || "Unknown") : "Unknown";
            const content = message.text.trim();
            const category = categorizeIncident(content);

            console.log(`📩 Auto-captured from [${groupTitle}] by [${senderName}]: ${content.substring(0, 50)}...`);

            const incidents = readIncidents();
            const now = new Date();
            
            // GROUPING LOGIC: Find an incident in the same group + same category within the last 2 hours
            const TWO_HOURS = 2 * 60 * 60 * 1000;
            const existingIncident = incidents.find(inc => 
                inc.source === groupTitle && 
                inc.category === category && 
                (now - new Date(inc.last_update)) < TWO_HOURS &&
                inc.status !== 'Resolved'
            );

            if (existingIncident) {
                // ADD TO THREAD
                existingIncident.updates.push({
                    timestamp: now.toISOString(),
                    sender: senderName,
                    content: content
                });
                existingIncident.last_update = now.toISOString();
                existingIncident.status = 'In Progress'; // Auto-escalate if new message comes in
            } else {
                // CREATE NEW GROUPED INCIDENT
                const newIncident = {
                    id: Date.now().toString(),
                    first_timestamp: now.toISOString(),
                    last_update: now.toISOString(),
                    category: category,
                    main_content: content,
                    status: 'Captured',
                    assigned_to: 'Pending Review',
                    source: groupTitle, // Group name
                    updates: [{
                        timestamp: now.toISOString(),
                        sender: senderName,
                        content: content
                    }],
                    duration_minutes: 0
                };
                incidents.push(newIncident);
            }
            writeIncidents(incidents);
        }
    }, new NewMessage({}));
}

initTelegram();

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// Incident Database Helpers
const INCIDENTS_FILE = path.join(__dirname, 'incidents.json');

function readIncidents() {
    try {
        if (!fs.existsSync(INCIDENTS_FILE)) return [];
        return JSON.parse(fs.readFileSync(INCIDENTS_FILE));
    } catch (e) { return []; }
}

function writeIncidents(data) {
    // RETENTION POLICY: Keep only last 90 days (3 months)
    const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
    const now = new Date();
    const filteredData = data.filter(inc => {
        const incDate = new Date(inc.last_update || inc.first_timestamp || inc.timestamp);
        return (now - incDate) < NINETY_DAYS;
    });

    fs.writeFileSync(INCIDENTS_FILE, JSON.stringify(filteredData, null, 2));
}

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

// API: Get all incidents
app.get('/api/incidents', (req, res) => {
    res.json(readIncidents());
});

// API: Log a new incident (Manual)
app.post('/api/incidents', (req, res) => {
    const { content, assigned_to } = req.body;
    if (!content) return res.status(400).json({ error: "Content is required" });

    const incidents = readIncidents();
    const now = new Date();
    const newIncident = {
        id: Date.now().toString(),
        first_timestamp: now.toISOString(),
        last_update: now.toISOString(),
        category: categorizeIncident(content),
        main_content: content,
        status: 'Active',
        assigned_to: assigned_to || 'Unassigned',
        source: 'Manual Input',
        updates: [{
            timestamp: now.toISOString(),
            sender: assigned_to || 'System',
            content: content
        }],
        duration_minutes: 0
    };

    incidents.push(newIncident);
    writeIncidents(incidents);
    res.json(newIncident);
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
