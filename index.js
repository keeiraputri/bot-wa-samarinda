const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');

// Menghapus folder auth jika belum bertaut
function purgeUnregisteredSession() {
    const credsPath = path.join(AUTH_DIR, 'creds.json');
    if (fs.existsSync(credsPath)) {
        try {
            const credsData = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
            if (!credsData.registered) {
                console.log('🧹 Menghapus sesi lama...');
                fs.rmSync(AUTH_DIR, { recursive: true, force: true });
            }
        } catch (e) {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        }
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
    purgeUnregisteredSession();

    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
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
            // Membuat URL gambar QR Code beresolusi tinggi
            const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
            
            console.log('\n==============================================');
            console.log('🔗 BUKA LINK DI BAWAH INI UNTUK SCAN QR JELAS:');
            console.log(qrImageUrl);
            console.log('==============================================\n');
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`[KONEKSI TERPUTUS] Status Code: ${statusCode}`);

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 408 || statusCode === 515) {
                if (fs.existsSync(AUTH_DIR)) {
                    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                }
            }

            setTimeout(() => startBot(), 5000);
        } else if (connection === 'open') {
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
