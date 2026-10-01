const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fetch = require('node-fetch');

// Mengambil API Key dari Environment Variable Railway/Render
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function getGeminiReply(userPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  const systemContext = `Anda adalah AI Assistant cerdas sekaligus CS Virtual resmi 'bangunrumah.online' (Bangun Rumah Samarinda).

PERAN & KEMAMPUAN UTAMA:
1. MATEMATIKA & PERKALIAN: Jawab semua perhitungan/perkalian dengan cepat dan akurat.
2. ESTIMASI BIAYA BANGUN RUMAH / RAB:
   - Biaya dasar pembangunan: Rp 3.100.000 / m².
   - Biaya = Luas x Rp 3.100.000. Jika 2 lantai, kalikan luas dengan 2.
3. PENGETAHUAN UMUM: Jawab pertanyaan umum dan sapaan santai secara ramah.

GAYA BAHASA: Jawab dengan sopan, ramah, dan komunikatif. Selipkan penawaran konsultasi & survei lokasi GRATIS di Samarinda jika relevan.`;

  const payload = {
    contents: [{ parts: [{ text: `${systemContext}\n\nPertanyaan Pelanggan: ${userPrompt}` }] }]
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await response.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text || "Halo! Ada yang bisa kami bantu mengenai rencana pembangunan atau renovasi rumah Anda?";
  } catch (err) {
    console.error("Error Gemini API:", err);
    return "Halo! Terima kasih telah menghubungi Bangun Rumah Samarinda. Ada yang bisa kami bantu?";
  }
}

async function connectToWhatsApp() {
  // Menyimpan sesi login di folder 'auth_info_baileys'
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      console.log('--- SCAN QR CODE DI BAWAH INI MENGGUNAKAN WHATSAPP ---');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Koneksi terputus, mencoba menghubungkan ulang...', shouldReconnect);
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      console.log('✅ BOT WHATSAPP SAMARINDA BERHASIL TERHUBUNG!');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

    if (text) {
      console.log(`Pesan masuk dari ${sender}: ${text}`);
      const reply = await getGeminiReply(text);
      await sock.sendMessage(sender, { text: reply });
    }
  });
}

connectToWhatsApp();