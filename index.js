const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    Browsers
} = require("@whiskeysockets/baileys");
const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 8080;
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');

let currentQR = '';
let isConnected = false;

// Web Server
app.get('/', (req, res) => {
    if (isConnected) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>Bot WA Active</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
            <body style="font-family: Arial, sans-serif; text-align: center; padding-top: 50px; background: #f4f6f9;">
                <div style="background: white; padding: 30px; border-radius: 12px; display: inline-block; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
                    <h1 style="color: #2e7d32; margin-bottom: 10px;">✅ BOT BERHASIL TERHUBUNG!</h1>
                    <p style="color: #555;">CS Bangun Rumah Samarinda aktif dan siap membalas pesan.</p>
                </div>
            </body>
            </html>
        `);
    }

    if (!currentQR) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Menyiapkan QR Code...</title>
                <meta http-equiv="refresh" content="4">
                <meta name="viewport" content="width=device-width, initial-scale=1">
            </head>
            <body style="font-family: Arial, sans-serif; text-align: center; padding-top: 50px; background: #f4f6f9;">
                <div style="background: white; padding: 30px; border-radius: 12px; display: inline-block; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
                    <h2>⏳ Sedang Membuat QR Code...</h2>
                    <p style="color: #666;">Halaman ini otomatis muat ulang dalam 4 detik.</p>
                </div>
            </body>
            </html>
        `);
    }

    // Menggunakan API QR luar yang cepat dan stabil
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(currentQR)}`;

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Scan QR WhatsApp Bot</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <script>setTimeout(() => location.reload(), 8000);</script>
        </head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding-top: 30px; background: #f4f6f9;">
            <div style="background: white; padding: 25px; border-radius: 12px; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-width: 90%;">
                <h2 style="color: #075e54; margin-top: 0;">Scan QR Code WhatsApp</h2>
                <p style="color: #d32f2f; font-size: 13px; font-weight: bold; margin-bottom: 15px;">Arahkan kamera HP ke gambar di bawah ini:</p>
                <img src="${qrImageUrl}" alt="QR Code WhatsApp" style="width: 270px; height: 270px; border: 1px solid #ddd; padding: 8px; border-radius: 8px;" />
                <p style="color: #666; font-size: 12px; margin-top: 15px;">Otomatis refresh tiap 8 detik.</p>
            </div>
        </body>
        </html>
    `);
});

app.listen(PORT, () => console.log(`🌐 Web Server running di port ${PORT}`));

function clearAuth() {
    if (fs.existsSync(AUTH_DIR)) {
        console.log('🧹 Menghapus folder auth lama...');
        try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (e) {}
    }
}

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
    if (fs.existsSync(credsPath)) {
        try {
            const credsData = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
            if (!credsData.registered) clearAuth();
        } catch (e) {
            clearAuth();
        }
    }

    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Desktop'),
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQR = qr;
            console.log('📌 QR Code Baru Berhasil Dibuat di Tampilan Web!');
        }

        if (connection === 'close') {
            isConnected = false;
            currentQR = '';
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`[KONEKSI TERPUTUS] Status Code: ${statusCode}`);

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 408 || statusCode === 515) {
                clearAuth();
            }

            setTimeout(() => startBot(), 5000);
        } else if (connection === 'open') {
            isConnected = true;
            currentQR = '';
            console.log('\n==============================================');
            console.log('✅ BOT WHATSAPP BANGUN RUMAH SAMARINDA AKTIF!');
            console.log('==============================================\n');
        }
    });

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
