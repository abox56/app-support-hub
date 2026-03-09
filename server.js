const express = require('express');
const path = require('path');
const fs = require('fs');
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

const app = express();
app.use(express.json()); // Support JSON bodies

const PORT = process.env.PORT || 8000;

// Telegram Configuration
const apiId = 36039479;
const apiHash = "cbb4b1ed8cf7605931c48a56140366d7";
const stringSession = new StringSession(process.env.TG_SESSION || "1BQANOTEuMTA4LjU2LjE5OQG7nya/R9sdhjIWwzWavpQA/W7M+4ih/gh/rIeMQ4SqMxz+H3JYlivGtf9e6r9hgWx2J8ELw6KvbauSpwkZaNyg4fhkNjMHGYzMQbm7px4hua4eIEIFSd/7/vXsuPcZSPsTL7q1Kfo2BCgfY+nQBq9shSPXX1G6EoNHLD0zW+2DwMKx98oQLe/ea2MxbbyyIx5L+ZVclBPBv6EeNS2+5jaxgMyazx7wxbNeemd8LLlDBeiQPBHwAfPXUldZN5Z4deLnOEG53pKjY5WPm1ltOnRVJj7rQReFFp+KZ16xiP4Oscxqa7rn5gwy2ODwmZOj/Cwgra3sfelVDD3SUCMo2t4+AA==");

let tgClient;

async function initTelegram() {
    tgClient = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });
    await tgClient.connect();
    console.log("✅ Connected to Telegram as user.");
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
