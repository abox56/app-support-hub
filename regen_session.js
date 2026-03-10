const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input"); // Best for CLI input

const apiId = 36039479; // Your actual TG_API_ID
const apiHash = "cbb4b1ed8cf7605931c48a56140366d7"; // Your actual TG_API_HASH
const stringSession = new StringSession(""); // Empty for new session

(async () => {
    console.log("--- Cloudway Hub Telegram Session Generator ---");
    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    await client.start({
        phoneNumber: async () => await input.text("Enter your phone number (including +country code): "),
        password: async () => await input.text("Enter your 2FA password (if any): "),
        phoneCode: async () => await input.text("Enter the code you received from Telegram: "),
        onError: (err) => console.log(err),
    });

    console.log("\n✅ SUCCESSFULLY LOGGED IN!");
    console.log("\n-------------------------------------------");
    console.log("COPY AND SAVE THE FOLLOWING SESSION STRING:");
    console.log("-------------------------------------------\n");
    console.log(client.session.save());
    console.log("\n-------------------------------------------");
    console.log("Now update your TG_SESSION in Railway with this value.");
    
    process.exit(0);
})();
