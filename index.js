const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Model Gemini sudah diubah ke versi terbaru agar terhindar dari Error 404
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" }); 

async function startBot() {
    const authFolder = '/app/auth_info_baileys';
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "22.04.4"],
        syncFullHistory: false, // MENCEGAH SERVER CRASH SAAT BARU LOGIN
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        markOnlineOnConnect: true
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const statusCode = lastDisconnect.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            console.log(`Koneksi tertutup, mencoba menghubungkan ulang...`);
            
            if (statusCode === DisconnectReason.loggedOut) {
                if (fs.existsSync(authFolder)) {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                }
            }

            if (shouldReconnect) {
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            console.log('Bot WhatsApp Bangun Rumah Samarinda berhasil terhubung!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const phoneNumber = "6282155852493";
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n========================================`);
                console.log(` KODE PAIRING WHATSAPP ANDA: ${code} `);
                console.log(`========================================\n`);
            } catch (err) {
                console.error('Gagal meminta pairing code:', err);
            }
        }, 6000);
    }

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        
        if (msg.key.fromMe) return;
        if (!msg.message) return;

        const sender = msg.key.remoteJid;
        
        // Mencegah bot membalas update status/story WhatsApp
        if(sender === 'status@broadcast') return;

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
        }
    });
}

startBot();
