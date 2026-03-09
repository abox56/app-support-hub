const express = require('express');
const path = require('path');
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

// Fallback to index.html for unknown routes (SPA style)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 App Support Hub running at http://localhost:${PORT}`);
});
