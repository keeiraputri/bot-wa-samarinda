const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    Browsers,
    delay
} = require("@whiskeysockets/baileys");
const fs = require('fs');
const path = require('path');

const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
const PHONE_NUMBER = "6285849496579"; // Nomor WhatsApp Anda

// Fungsi pemanggilan Gemini API menggunakan model terbaru (Gemini 3.x)
async function askGemini(promptText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY tidak ditemukan di Variables Railway!");

    const systemInstruction = "Anda adalah Customer Service resmi Bangun Rumah Samarinda (jasa renovasi & pembangunan rumah di Samarinda). Jawablah pertanyaan pelanggan dengan ramah, singkat, dan informatif.";
    
    // Daftar nama model Gemini terbaru sesuai petunjuk log
    const models = [
        'gemini-3.8-flash',
        'gemini-3.1-pro-preview',
        'gemini-3.1-pro'
    ];

    let lastError = "";

    for (const model of models) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: `${systemInstruction}\n\nPertanyaan Pelanggan: ${promptText}` }]
                    }]
                })
            });

            if (response.ok) {
                const data = await response.json();
                const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (reply) return reply;
            } else {
                const errText = await response.text();
                console.log(`[DEBUG] Model ${model} gagal (${response.status}): ${errText}`);
                lastError = errText;
            }
        } catch (err) {
            console.log(`[DEBUG] Model ${model} error: ${err.message}`);
            lastError = err.message;
        }
    }

    throw new Error(`Semua model Gemini gagal. Detail: ${lastError}`);
}

async function startBot() {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.ubuntu("Chrome"),
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`[KONEKSI TERPUTUS] Status Code: ${statusCode}`);

            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                if (fs.existsSync(AUTH_DIR)) {
                    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                }
            }

            if (shouldReconnect) {
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            console.log('\n==============================================');
            console.log('✅ BOT WHATSAPP BANGUN RUMAH SAMARINDA AKTIF!');
            console.log('==============================================\n');
        }
    });

    // Minta Kode Pairing otomatis jika belum bertaut
    if (!sock.authState.creds.registered) {
        await delay(5000);
        try {
            const cleanPhone = PHONE_NUMBER.replace(/[^0-9]/g, '');
            const code = await sock.requestPairingCode(cleanPhone);
            console.log('\n==============================================');
            console.log(`🔑 KODE PAIRING WHATSAPP ANDA: ${code}`);
            console.log('==============================================');
            console.log('SEGERA MASUKKAN KODE INI DI WHATSAPP HP ANDA!\n');
        } catch (err) {
            console.error('Gagal meminta kode pairing:', err.message);
        }
    }

    // Mendengarkan Pesan Masuk
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];

        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        if (sender.endsWith('@g.us') || sender === 'status@broadcast') return;

        const body = msg.message.conversation ||
                     msg.message.extendedTextMessage?.text ||
                     msg.message.imageMessage?.caption ||
                     msg.message.videoMessage?.caption;

        if (!body) return;

        console.log(`📩 Pesan masuk dari ${sender}: "${body}"`);

        try {
            const aiReply = await askGemini(body);
            await sock.sendMessage(sender, { text: aiReply });
            console.log(`🤖 Berhasil membalas pesan ke ${sender}`);
        } catch (err) {
            console.error('❌ Gagal memproses AI:', err.message);
        }
    });
}

startBot();
