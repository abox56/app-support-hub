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

        // Get Chat Details
        const chat = await message.getChat();
        const sender = await message.getSender();

        // Only log if it's from a group or channel (not private 1v1)
        if (chat instanceof Api.Chat || chat instanceof Api.Channel) {
            const groupTitle = chat.title || "Unknown Group";
            const senderName = sender ? (sender.firstName || sender.username || "Unknown") : "Unknown";
            const content = message.text.trim();

            console.log(`📩 Auto-captured from [${groupTitle}] by [${senderName}]: ${content.substring(0, 50)}...`);

            // Internal log to incidents database
            const incidents = readIncidents();
            const newIncident = {
                id: Date.now().toString(),
                timestamp: new Date().toISOString(),
                category: categorizeIncident(content),
                content: content,
                status: 'Captured',
                assigned_to: 'Pending Review',
                source: `${groupTitle} | ${senderName}`, // RECORD SOURCE
                duration_minutes: 0
            };

            incidents.push(newIncident);
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
    fs.writeFileSync(INCIDENTS_FILE, JSON.stringify(data, null, 2));
}

// Simple categorization engine
function categorizeIncident(content) {
    const text = content.toLowerCase();
    if (text.includes('smi') || text.includes('latency')) return 'SMI Monitoring';
    if (text.includes('evolution') || text.includes('pragmatic') || text.includes('provider')) return 'Provider API';
    if (text.includes('ticket') || text.includes('customer')) return 'Customer Support';
    if (text.includes('database') || text.includes('db')) return 'System Infra';
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

// API: Log a new incident
app.post('/api/incidents', (req, res) => {
    const { content, assigned_to } = req.body;
    if (!content) return res.status(400).json({ error: "Content is required" });

    const incidents = readIncidents();
    const newIncident = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        category: categorizeIncident(content),
        content: content,
        status: 'Active',
        assigned_to: assigned_to || 'Unassigned',
        source: 'Manual Input', // Default source for manual logs
        duration_minutes: 0
    };

    incidents.push(newIncident);
    writeIncidents(incidents);
    res.json(newIncident);
});

// Fallback to index.html for unknown routes (SPA style)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 App Support Hub running at http://localhost:${PORT}`);
});
