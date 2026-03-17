const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
require('dotenv').config();

const apiId = parseInt(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
const stringSession = new StringSession(process.env.TG_SESSION);

(async () => {
    console.log("Connecting to Telegram...");
    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });
    await client.connect();
    console.log("Connected.");

    const dialogs = await client.getDialogs();
    const targetChat = dialogs.find(d => d.title && d.title.includes("CW App Int Group"));

    if (!targetChat) {
        console.log("Could not find chat with title including 'CW App Int Group'");
        // List some dialog titles to help debugging
        console.log("Available dialogs:", dialogs.slice(0, 10).map(d => d.title).join(", "));
        process.exit(1);
    }

    const chatId = targetChat.id;
    const chatTitle = targetChat.title;
    console.log(`Found chat: ${chatTitle} (ID: ${chatId})`);

    const message = "Current PIC: DJ (10am-7pm)";
    console.log(`Sending message: "${message}"`);
    
    const sentMsg = await client.sendMessage(chatId, { message });
    console.log(`Message sent. ID: ${sentMsg.id}`);

    console.log("Pinning message...");
    try {
        await client.invoke(
            new Api.messages.UpdatePinnedMessage({
                peer: chatId,
                id: sentMsg.id,
                unpin: false,
                pmOneSide: false,
            })
        );
        console.log("✅ Message pinned successfully!");
    } catch (err) {
        console.error("❌ Failed to pin message:", err);
    }

    await client.disconnect();
    process.exit(0);
})();
