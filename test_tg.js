require('dotenv').config();
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");

const apiId = 36039479;
const apiHash = "cbb4b1ed8cf7605931c48a56140366d7";
const stringSession = new StringSession(process.env.TG_SESSION || "");

(async () => {
    console.log("--- TG Client Health Check ---");
    const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 3 });
    try {
        await client.connect();
        const me = await client.getMe();
        console.log(`✅ Connected as: @${me.username || 'User'}`);
        
        console.log("--- Recent Dialogs (Total Groups/Chats) ---");
        const dialogs = await client.getDialogs({ limit: 5 });
        dialogs.forEach(d => {
            console.log(`- Chat: ${d.title} (ID: ${d.id.toString()}) | Last Msg: ${d.message ? d.message.message?.substring(0, 30) : 'None'}`);
        });
        
    } catch (e) {
        console.error("❌ TG Check Failed:", e.message);
    }
    process.exit(0);
})();
