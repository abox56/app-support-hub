const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");

const apiId = 36039479;
const apiHash = "cbb4b1ed8cf7605931c48a56140366d7";
const stringSession = new StringSession(""); // Empty for new login

(async () => {
    console.log("--- Telegram Account Linker ---");
    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    await client.start({
        phoneNumber: async () => await input.text("Please enter your number (with country code, e.g. +60...): "),
        password: async () => await input.text("Please enter your 2FA password (leave blank if none): "),
        phoneCode: async () => await input.text("Please enter the code you received from Telegram: "),
        onError: (err) => console.log(err),
    });

    console.log("\n✅ Login Success!");
    console.log("--- SAVE THIS SESSION STRING ---");
    console.log(client.session.save());
    console.log("---------------------------------");
    console.log("Close this terminal after copying the string.");

    await client.sendMessage("me", { message: "Test: Cloudway Support Hub linked successfully!" });
    process.exit(0);
})();
