const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('/app/auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false
    });

    if (!sock.authState.creds.registered) {
        const phoneNumber = "6281234567890"; // Ganti dengan nomor WhatsApp Anda
        
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

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });

            await sock.sendMessage(sender, { text: response.text });
        } catch (error) {
            console.error('Gagal merespons:', error);
        }
    });
}

startBot();
