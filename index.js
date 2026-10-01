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

// Fungsi pemanggilan Gemini API dengan penanganan Rate Limit & Model Resmi
async function askGemini(promptText, retryCount = 0) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY tidak ditemukan di Variables Railway!");

    const systemInstruction = "Anda adalah Customer Service resmi Bangun Rumah Samarinda (jasa renovasi & pembangunan rumah di Samarinda). Jawablah pertanyaan pelanggan dengan ramah, singkat, dan informatif.";
    
    // Model resmi dan paling stabil dari Google AI Studio
    const models = [
        'gemini-1.5-flash',
        'gemini-1.5-pro'
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
                const errData = await response.json().catch(() => ({}));
                const status = response.status;

                // Jika terkena batas kuota / rate limit (Status 429), lakukan tunggu otomatis
                if ((status === 429 || errData?.error?.message?.includes('quota')) && retryCount < 2) {
                    console.log(`[RATE LIMIT] Terkena batas kuota gratisan. Menunggu 10 detik sebelum coba lagi...`);
                    await delay(10000); // Tunggu 10 detik
                    return await askGemini(promptText, retryCount + 1);
                }

                lastError = errData?.error?.message || `HTTP ${status}`;
                console.log(`[DEBUG] Model ${model} gagal (${status}): ${lastError}`);
            }
        } catch (err) {
            console.log(`[DEBUG] Model ${model} error: ${err.message}`);
            lastError = err.message;
        }
    }

    throw new Error(`Gagal memproses AI: ${lastError}`);
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
