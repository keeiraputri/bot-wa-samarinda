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

// Fungsi integrasi langsung ke API Gemini
async function askGemini(promptText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY tidak ditemukan di Variables Railway!");

    const systemInstruction = "Anda adalah Customer Service resmi Bangun Rumah Samarinda (jasa renovasi & pembangunan rumah di Samarinda). Jawablah pertanyaan pelanggan dengan ramah, singkat, dan informatif.";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [{ text: `${systemInstruction}\n\nPertanyaan Pelanggan: ${promptText}` }]
            }]
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API Error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "Maaf, sistem sedang memproses permintaan Anda.";
}

async function startBot() {
    // Memastikan menggunakan versi Baileys WhatsApp terbaru
    const { version } = await fetchLatestBaileysVersion();
    console.log(`[INFO] Menggunakan WhatsApp Web Version: v${version.join('.')}`);

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.ubuntu("Chrome"),
        syncFullHistory: false, // Menghindari crash memori
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

            // Jika logout atau ada ralat autentikasi, hapus sesi agar bisa pautan ulang dengan bersih
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 405) {
                console.log('Sesi rusak/tidak valid. Menghapus folder auth_info_baileys...');
                if (fs.existsSync(AUTH_DIR)) {
                    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                }
            }

            if (shouldReconnect) {
                console.log('Mencoba menghubungkan ulang dalam 5 detik...');
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            console.log('\n==============================================');
            console.log('✅ BOT WHATSAPP SAMARINDA BERHASIL TERHUBUNG!');
            console.log('==============================================\n');
        }
    });

    // Minta kode pautan hanya jika belum terdaftar
    if (!sock.authState.creds.registered) {
        await delay(6000);
        try {
            const cleanPhone = PHONE_NUMBER.replace(/[^0-9]/g, '');
            const code = await sock.requestPairingCode(cleanPhone);
            console.log('\n==============================================');
            console.log(`🔑 KODE PAIRING BARU: ${code}`);
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

        console.log(`📩 Pesan dari ${sender}: "${body}"`);

        try {
            const aiReply = await askGemini(body);
            await sock.sendMessage(sender, { text: aiReply });
            console.log(`🤖 Berhasil membalas ${sender}`);
        } catch (err) {
            console.error('❌ Gagal memproses AI:', err.message);
        }
    });
}

startBot();
