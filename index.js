const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const QRCode = require('qrcode');
const { OpenAI } = require('openai');

const app = express();
const PORT = process.env.PORT || 8100;

let qrCodeData = '';

// Inisialisasi Client OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "SK-YOUR-OPENAI-API-KEY",
});

async function askAI(promptText) {
  // 1. Fitur Matematika Sederhana
  const cleanMath = promptText.replace(/x/gi, '*').replace(/÷/g, '/');
  if (/^[0-9\s\+\-\*\/\.\(\)]+$/.test(cleanMath.trim())) {
    try {
      const res = eval(cleanMath);
      return `Hasil dari ${promptText} adalah ${res}`;
    } catch (e) {}
  }

  // 2. Kirim Permintaan ke OpenAI
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Bisa diganti gpt-4o, gpt-4.1-mini, dll.
      messages: [
        {
          role: "system",
          content: "Kamu adalah asisten AI yang ramah, cerdas, dan responsif dari Bangun Rumah Samarinda. Jawab pertanyaan pengguna secara ringkas, jelas, dan natural dalam bahasa Indonesia."
        },
        {
          role: "user",
          content: promptText
        }
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const reply = response.choices[0]?.message?.content;
    if (reply) return reply.trim();

    throw new Error("Respon OpenAI kosong");

  } catch (err) {
    console.error("OpenAI SDK Error Detail:", err.message || err);
    return "Maaf, terjadi kendala saat memproses jawaban. Silakan coba beberapa saat lagi.";
  }
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      QRCode.toDataURL(qr, (err, url) => {
        if (!err) qrCodeData = url;
      });
    }
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      console.log('BOT WHATSAPP AKTIF BERHASIL!');
      qrCodeData = '';
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const from = msg.key.remoteJid;
      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

      if (!text) continue;

      console.log(`Pesan masuk dari ${from}: ${text}`);

      // Dapatkan balasan dari AI / Matematika
      const aiResponse = await askAI(text);
      await sock.sendMessage(from, { text: aiResponse }, { quoted: msg });
    }
  });
}

// Server HTTP untuk Pairing Code / QR Code Viewer
app.get('/', (req, res) => {
  if (qrCodeData) {
    res.send(`<h2>Scan QR Code WhatsApp:</h2><img src="${qrCodeData}"/>`);
  } else {
    res.send('<h2>Bot WhatsApp Aktif & Terhubung!</h2>');
  }
});

app.listen(PORT, () => {
  console.log(`Server HTTP berjalan di port ${PORT}`);
  connectToWhatsApp();
});
