const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('/app/auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false
    });

    if (!sock.authState.creds.registered) {
        const phoneNumber = "6282155852493"; // Ganti dengan nomor WhatsApp Anda
        
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n========================================`);
                console.log(` KODE PAIRING WHATSAPP ANDA: ${code} `);
                console.log(`========================================\n`);
            } catch (err) {
                console.error('Gagal meminta pairing code:', err);
            }
        }, 5000);
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('Bot WhatsApp Bangun Rumah Samarinda berhasil terhubung!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!textMessage) return;

        try {
            const prompt = `Anda adalah customer service profesional untuk "Bangun Rumah Samarinda", jasa kontraktor dan renovasi rumah di Kota Samarinda. Jawablah pertanyaan klien berikut: "${textMessage}"`;

            const result = await model.generateContent(prompt);
            const response = await result.response;
            await sock.sendMessage(sender, { text: response.text() });
        } catch (error) {
            console.error('Gagal merespons:', error);
        }
    });
}

startBot();
