const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    Browsers,
    delay
} = require("@whiskeysockets/baileys");
const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');

// MASUKKAN NOMOR WA BOT ANDA DI SINI (Format: 628xxx tanpa tanda + atau spasi)
const PHONE_NUMBER = "6282155852493"; 

let currentPairingCode = '';
let isConnected = false;

// Web Server untuk menampilkan Kode Pairing
app.get('/', (req, res) => {
    if (isConnected) {
        return res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                <h1 style="color:green;">✅ BOT WHATSAPP AKTIF & TERHUBUNG!</h1>
                <p>Layanan CS Bangun Rumah Samarinda siap membalas pesan.</p>
            </div>
        `);
    }

    if (!currentPairingCode) {
        return res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                <h2>⏳ Sedang Meminta Kode Pairing Baru...</h2>
                <p>Halaman ini akan memuat ulang otomatis dalam 5 detik.</p>
                <script>setTimeout(() => location.reload(), 5000);</script>
            </div>
        `);
    }

    res.send(`
        <div style="text-align:center; font-family:sans-serif; margin-top:40px;">
            <h2>Kode Tautan WhatsApp Bot</h2>
            <p>Masukkan 8 digit kode di bawah ini pada WhatsApp HP Anda:</p>
            <div style="font-size: 42px; font-weight: bold; letter-spacing: 5px; color: #007bff; margin: 20px 0; background: #f0f4f8; padding: 15px; display: inline-block; border-radius: 10px; border: 2px dashed #007bff;">
                ${currentPairingCode}
            </div>
            <p style="color: #666; font-size: 14px;">Buka WhatsApp > Perangkat Tertaut > Tautkan Perangkat > <b>Tautkan dengan nomor telepon saja</b></p>
            <script>setTimeout(() => location.reload(), 15000);</script>
        </div>
    `);
});

app.listen(PORT, () => console.log(`🌐 Web Server berjalan di port ${PORT}`));

// Fungsi Hapus Sesi Korup
function purgeSession() {
    if (fs.existsSync(AUTH_DIR)) {
        console.log('🧹 Menghapus folder auth lama...');
        try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (e) {}
    }
}

// Fungsi AI Groq
async function askAI(promptText) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY tidak ditemukan di Variables Railway!");

    const systemInstruction = "Anda adalah Customer Service resmi Bangun Rumah Samarinda (jasa renovasi & pembangunan rumah di Samarinda). Jawablah pertanyaan pelanggan dengan ramah, singkat, jelas, dan informatif.";

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: systemInstruction },
                { role: "user", content: promptText }
            ],
            temperature: 0.7,
            max_tokens: 500
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Groq API Error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "Maaf, layanan kami sedang tidak dapat memproses balasan saat ini.";
}

async function startBot() {
    const credsPath = path.join(AUTH_DIR, 'creds.json');
    
    // Jika belum terdaftar, bersihkan sesi lama agar kunci enkripsi selalu fresh
    if (fs.existsSync(credsPath)) {
        try {
            const credsData = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
            if (!credsData.registered) purgeSession();
        } catch (e) {
            purgeSession();
        }
    }

    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
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
            isConnected = false;
            currentPairingCode = '';
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`[KONEKSI TERPUTUS] Status Code: ${statusCode}`);

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 408 || statusCode === 515) {
                purgeSession();
            }

            setTimeout(() => startBot(), 5000);
        } else if (connection === 'open') {
            isConnected = true;
            currentPairingCode = '';
            console.log('\n==============================================');
            console.log('✅ BOT WHATSAPP BANGUN RUMAH SAMARINDA AKTIF!');
            console.log('==============================================\n');
        }
    });

    // Minta Kode Pairing jika belum terhubung
    if (!sock.authState.creds.registered) {
        await delay(5000);
        try {
            const cleanPhone = PHONE_NUMBER.replace(/[^0-9]/g, '');
            const code = await sock.requestPairingCode(cleanPhone);
            
            // Format kode agar ada tanda strip (-) di tengah
            currentPairingCode = code?.match(/.{1,4}/g)?.join("-") || code;

            console.log('\n==============================================');
            console.log(`🔑 KODE PAIRING BARU: ${currentPairingCode}`);
            console.log('==============================================\n');
        } catch (err) {
            console.error('Gagal meminta kode pairing:', err.message);
        }
    }

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
            const aiReply = await askAI(body);
            await sock.sendMessage(sender, { text: aiReply });
            console.log(`🤖 Berhasil membalas pesan ke ${sender}`);
        } catch (err) {
            console.error('❌ Gagal memproses AI:', err.message);
        }
    });
}

startBot();
