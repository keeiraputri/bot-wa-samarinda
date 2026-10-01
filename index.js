const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require("@whiskeysockets/baileys");
const fs = require('fs');
const path = require('path');

const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
const PHONE_NUMBER = "6282155852493"; // Nomor WhatsApp Anda

// Fungsi pemanggilan Gemini AI langsung via REST API (Bebas Error 404)
async function askGemini(promptText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY belum dipasang di Environment Variables Railway!");
    }

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
        throw new Error(`Gemini Error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "Maaf, sistem sedang memproses permintaan Anda. Silakan coba sebentar lagi.";
}

async function startBot() {
    // Memuat sesi login
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        syncFullHistory: false, // Mencegah server kehabisan memori
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`[KONEKSI TERPUTUS] Status Code: ${statusCode}`);

            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            // Jika sesi tidak valid, hapus folder sesi otomatis agar bisa pautan ulang dari awal
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log('Sesi kedaluwarsa. Membesihkan folder auth_info_baileys...');
                if (fs.existsSync(AUTH_DIR)) {
                    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                }
            }

            if (shouldReconnect) {
                console.log('Mencoba menghubungkan ulang dalam 5 detik...');
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            console.log('==============================================');
            console.log('✅ BOT WHATSAPP BANGUN RUMAH SAMARINDA AKTIF!');
            console.log('==============================================');
        }
    });

    // Request Kode Pairing jika belum bertaut
    if (!sock.authState.creds.registered) {
        await delay(6000);
        try {
            const cleanPhone = PHONE_NUMBER.replace(/[^0-9]/g, '');
            const code = await sock.requestPairingCode(cleanPhone);
            console.log('\n==============================================');
            console.log(`🔑 KODE PAIRING WHATSAPP ANDA: ${code}`);
            console.log('==============================================\n');
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
        // Abaikan pesan grup dan update status
        if (sender.endsWith('@g.us') || sender === 'status@broadcast') return;

        const body = msg.message.conversation ||
                     msg.message.extendedTextMessage?.text ||
                     msg.message.imageMessage?.caption ||
                     msg.message.videoMessage?.caption;

        if (!body) return;

        console.log(`📩 Pesan masuk dari ${sender}: "${body}"`);

        try {
            const aiReply = await askGemini(body);
            console.log(`🤖 Mengirim balasan ke ${sender}`);
            await sock.sendMessage(sender, { text: aiReply });
        } catch (err) {
            console.error('❌ Gagal memproses AI:', err.message);
        }
    });
}

startBot();
