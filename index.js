const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 8000;
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');

let sock = null;
let isConnected = false;
let currentPairingCode = '';
let pairingError = '';

function clearAuth() {
    if (fs.existsSync(AUTH_DIR)) {
        try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (e) {}
    }
}

async function askAI(promptText) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY tidak ditemukan!");

    const systemInstruction = "Anda adalah Customer Service resmi Bangun Rumah Samarinda (jasa renovasi & pembangunan rumah di Samarinda). Jawablah pertanyaan pelanggan secara ramah, profesional, dan informatif.";

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

async function initSocket() {
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

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ["Mac OS", "Chrome", "121.0.6167.85"],
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        markOnlineOnConnect: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            isConnected = false;
            currentPairingCode = '';
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`Koneksi Terputus: Status ${statusCode}`);

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 408) {
                clearAuth();
            }
            setTimeout(() => initSocket(), 5000);
        } else if (connection === 'open') {
            isConnected = true;
            currentPairingCode = '';
            console.log('\n====================================================');
            console.log('✅ BOT WHATSAPP BANGUN RUMAH SAMARINDA AKTIF!');
            console.log('====================================================\n');
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

app.get('/', (req, res) => {
    if (isConnected) {
        return res.send(`
            <html>
            <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background: #f0f2f5;">
                <div style="background: white; padding: 30px; border-radius: 10px; display: inline-block;">
                    <h1 style="color: #25D366;">✅ BOT WHATSAPP AKTIF!</h1>
                    <p style="color: #555;">CS Bangun Rumah Samarinda siap melayani pesan.</p>
                </div>
            </body>
            </html>
        `);
    }

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Tautkan Bot WA</title>
            <style>
                body { font-family: sans-serif; text-align: center; padding: 30px 15px; background: #f0f2f5; }
                .card { background: white; padding: 25px; border-radius: 12px; display: inline-block; max-width: 400px; width: 100%; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                input { width: 90%; padding: 12px; margin: 10px 0; border: 1px solid #ccc; border-radius: 6px; font-size: 16px; text-align: center; }
                button { background: #25D366; color: white; border: none; padding: 12px 20px; font-size: 16px; border-radius: 6px; cursor: pointer; font-weight: bold; width: 95%; margin-top: 5px; }
                .code { font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #075e54; background: #e7fceb; padding: 15px; border-radius: 8px; margin-top: 15px; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>🔑 Tautkan Bot WhatsApp</h2>
                <p style="color: #666; font-size: 14px;">Masukkan nomor WA yang ingin dijadikan Bot (awalan 62):</p>
                <form method="POST" action="/get-code">
                    <input type="text" name="phone" placeholder="Contoh: 628123456789" required /><br>
                    <button type="submit">Dapatkan Kode Tautan</button>
                </form>
                ${currentPairingCode ? `
                    <div class="code">${currentPairingCode}</div>
                    <p style="color:#333; font-size:13px; margin-top:10px;">
                        <b>Cara Masukkan Kode:</b><br>
                        Buka WA di HP > Perangkat Tertaut > Tautkan Perangkat > Pilih <b>"Tautkan dengan nomor telepon saja"</b> di bawah.
                    </p>
                ` : ''}
                ${pairingError ? `<p style="color:red; font-size:14px; margin-top:10px;">${pairingError}</p>` : ''}
            </div>
        </body>
        </html>
    `);
});

app.post('/get-code', async (req, res) => {
    let phone = req.body.phone?.replace(/[^0-9]/g, '');
    if (!phone) {
        pairingError = "Nomor telepon tidak valid!";
        return res.redirect('/');
    }
    if (!sock) {
        pairingError = "Sistem belum siap, tunggu 5 detik lalu coba lagi.";
        return res.redirect('/');
    }
    try {
        pairingError = '';
        let code = await sock.requestPairingCode(phone);
        code = code?.match(/.{1,4}/g)?.join("-") || code;
        currentPairingCode = code;
    } catch (err) {
        console.error("Gagal meminta kode:", err);
        pairingError = "Gagal meminta kode. Pastikan nomor benar dan belum terhubung.";
    }
    res.redirect('/');
});

app.listen(PORT, '::', () => {
    console.log(`🌐 Web Server running on port ${PORT}`);
    initSocket();
});
