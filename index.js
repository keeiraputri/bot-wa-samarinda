const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { GoogleGenAI } = require("@google/genai");
const fs = require('fs');
const readline = require('readline');

// Inisialisasi Gemini API Key dari Environment Variable Railway
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('/app/auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false // Kita nonaktifkan QR Code terminal agar pakai Pairing Code
    });

    // Jika belum terhubung, gunakan Pairing Code via Nomor HP
    if (!sock.authState.creds.registered) {
        // Masukkan nomor WhatsApp bot Anda di sini (contoh: 62812345678)
        const phoneNumber = await question('Masukkan nomor WhatsApp Anda (cth: 628xxx): ');
        const code = await sock.requestPairingCode(phoneNumber);
        console.log(`\n========================================`);
        console.log(` KODE PAIRING WHATSAPP ANDA: ${code} `);
        console.log(`========================================\n`);
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus, mencoba menghubungkan kembali...', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('Bot WhatsApp Bangun Rumah Samarinda berhasil terhubung!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Fitur AI Gemini untuk merespons pesan masuk
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (!textMessage) return;

        console.log(`Pesan masuk dari ${sender}: ${textMessage}`);

        try {
            // Konteks khusus untuk layanan Bangun Rumah Samarinda
            const prompt = `Anda adalah customer service profesional untuk "Bangun Rumah Samarinda", sebuah jasa kontraktor dan renovasi rumah terpercaya di Kota Samarinda. Jawablah pertanyaan klien berikut secara ramah, informatif, dan mengarahkan mereka untuk menggunakan jasa renovasi atau pembangunan rumah lantai 2 di Samarinda: "${textMessage}"`;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });

            const replyText = response.text;
            await sock.sendMessage(sender, { text: replyText });
        } catch (error) {
            console.error('Gagal merespons dengan Gemini AI:', error);
            await sock.sendMessage(sender, { text: 'Maaf, sistem AI sedang sibuk. Silakan coba beberapa saat lagi.' });
        }
    });
}

startBot();
