const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 8100;

let qrCodeData = '';

async function askAI(promptText) {
  // 1. Fitur Matematika Sederhana
  const cleanMath = promptText.replace(/x/gi, '*').replace(/÷/g, '/');
  if (/^[0-9\s\+\-\*\/\.\(\)]+$/.test(cleanMath.trim())) {
    try {
      const res = eval(cleanMath);
      return `Hasil dari ${promptText} adalah ${res}`;
    } catch (e) {}
  }

  // 2. Ambil Kunci dari Environment
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("GEMINI_API_KEY belum dikonfigurasi.");
    return "Maaf, sistem AI belum siap.";
  }

  // 3. Panggilan HTTP Langsung ke API Google Gemini
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

    const requestBody = {
      systemInstruction: {
        parts: [{ text: "Kamu adalah asisten AI yang ramah, cerdas, dan responsif dari Bangun Rumah Samarinda. Jawab pertanyaan pengguna secara ringkas, jelas, dan natural dalam bahasa Indonesia." }]
      },
      contents: [{
        parts: [{ text: promptText }]
      }]
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("HTTP Error Response:", JSON.stringify(data));
      throw new Error(data.error?.message || `HTTP status ${response.status}`);
    }

    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (responseText) return responseText.trim();

    throw new Error("Respon AI kosong");

  } catch (err) {
    console.error("Gemini Direct Fetch Error:", err.message || err);
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

      const aiResponse = await askAI(text);
      await sock.sendMessage(from, { text: aiResponse }, { quoted: msg });
    }
  });
}

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
