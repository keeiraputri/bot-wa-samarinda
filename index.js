const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('/app/auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "22.04.4"],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        markOnlineOnConnect: true
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log('Koneksi terputus, mencoba menghubungkan ulang...');
                startBot();
            }
        } else if (connection === 'open') {
            console.log('Bot WhatsApp Bangun Rumah Samarinda berhasil terhubung!');

            // Meminta pairing code setelah koneksi benar-benar terbuka dan mapan
            if (!sock.authState.creds.registered) {
                try {
                    const phoneNumber = "6282155852493";
                    // Beri jeda singkat 3 detik setelah open agar stabil
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    const code = await sock.requestPairingCode(phoneNumber);
                    console.log(`\n========================================`);
                    console.log(` KODE PAIRING WHATSAPP ANDA: ${code} `);
                    console.log(`========================================\n`);
                } catch (err) {
                    console.error('Gagal meminta pairing code:', err);
                }
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        
        if (msg.key.fromMe) return;
        if (!msg.message) return;

        const sender = msg.key.remoteJid;
        
        const textMessage = msg.message.conversation || 
                            msg.message.extendedTextMessage?.text || 
                            msg.message.imageMessage?.caption || 
                            msg.message.videoMessage?.caption;

        if (!textMessage) return;

        console.log(`Pesan masuk dari ${sender}: ${textMessage}`);

        try {
            const prompt = `Anda adalah customer service profesional untuk "Bangun Rumah Samarinda", jasa kontraktor dan renovasi rumah di Kota Samarinda. Jawablah pertanyaan klien berikut: "${textMessage}"`;

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const replyText = response.text();

            console.log(`Mengirim balasan ke ${sender}`);
            await sock.sendMessage(sender, { text: replyText });
        } catch (error) {
            console.error('Gagal merespons dengan AI:', error);
            await sock.sendMessage(sender, { text: 'Maaf, sistem sedang memproses permintaan Anda. Silakan coba sebentar lagi.' });
        }
    });
}

startBot();
