const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const http = require('http');

const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
let pairingCode = "Sedang memproses... Refresh halaman ini beberapa detik lagi.";
let isConnected = false;

if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

let sock = null;

function clearAuth() {
  if (fs.existsSync(AUTH_DIR)) {
    try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (e) {}
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function keepTyping(jid, durationMs = 3000) {
  const intervalMs = 1500;
  const startTime = Date.now();
  
  while (Date.now() - startTime < durationMs) {
    try {
      if (sock) await sock.sendPresenceUpdate('composing', jid);
    } catch (e) {}
    const remaining = durationMs - (Date.now() - startTime);
    if (remaining > 0) {
      await sleep(Math.min(intervalMs, remaining));
    }
  }
}

async function askAI(promptText) {
  // 1. Cek jika input adalah Matematika Sederhana
  const cleanMath = promptText.replace(/x/gi, '*').replace(/÷/g, '/');
  if (/^[0-9\s\+\-\*\/\.\(\)]+$/.test(cleanMath.trim())) {
    try {
      const res = eval(cleanMath);
      return `Hasil dari ${promptText} adalah ${res}`;
    } catch (e) {}
  }

  // 2. Baca API Key dari Environment Variable atau kunci langsung
  const apiKey = process.env.GEMINI_API_KEY || "AQ.Ab8RN6If7Ct5MKJ2QI3PQJNR38RWdQRPm0U3fdCu3ET8Yrxlw";

  if (!apiKey) {
    console.error("GEMINI_API_KEY belum dikonfigurasi.");
    return "Maaf, sistem AI sedang belum siap.";
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    // Menggunakan model efisien gemini-2.5-flash-lite (atau gemini-1.5-flash)
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash-lite",
      systemInstruction: "Kamu adalah asisten AI yang ramah, cerdas, dan responsif dari Bangun Rumah Samarinda. Jawab pertanyaan pengguna secara ringkas, jelas, dan natural dalam bahasa Indonesia."
    });

    const result = await model.generateContent(promptText);
    const responseText = result.response.text();

    if (responseText) return responseText.trim();

    throw new Error("Respon AI kosong");

  } catch (err) {
    console.error("Gemini SDK Error Detail:", err.message || err);
    return "Maaf, terjadi kendala saat memproses jawaban. Silakan coba beberapa saat lagi.";
  }
}

async function initSocket() {
  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    keepAliveIntervalMs: 10000,
    pingIntervalMs: 10000,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 0
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      isConnected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log(`[RECONNECT] Terputus (Status Code: ${statusCode})`);

      if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
        console.log('[LOGOUT] Sesi dicabut dari WhatsApp, membersihkan folder auth...');
        clearAuth();
      }

      setTimeout(() => initSocket(), 3000);

    } else if (connection === 'open') {
      isConnected = true;
      pairingCode = "Bot WhatsApp Sudah Terhubung!";
      console.log('BOT WHATSAPP AKTIF BERHASIL!');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg || msg.key.fromMe) return;

      const from = msg.key.remoteJid;
      const body = msg.message?.conversation || 
                   msg.message?.extendedTextMessage?.text || 
                   msg.message?.imageMessage?.caption || 
                   "";

      if (!body || body.trim() === "") return;

      const textLower = body.toLowerCase().trim();

      const homeKeywords = ['renovasi', 'bangun rumah', 'atap bocor', 'tukang bangunan', 'borongan rumah', 'cat rumah', 'pasang semen'];
      const isHomeService = homeKeywords.some(kw => textLower.includes(kw));

      if (isHomeService) {
        await keepTyping(from, 3000);
        if (sock) await sock.sendPresenceUpdate('paused', from);
        await sock.sendMessage(from, { 
          text: "Halo! Mohon tunggu sebentar ya, pesan Anda akan segera dibalas oleh tim kami. Terima kasih!" 
        });
      } else {
        const replyPromise = askAI(body);
        const typingPromise = keepTyping(from, 3000);

        const [reply] = await Promise.all([replyPromise, typingPromise]);
        
        if (sock) await sock.sendPresenceUpdate('paused', from);
        await sock.sendMessage(from, { text: reply });
      }
    } catch (generalErr) {
      console.error("Error handling message:", generalErr);
    }
  });
}

process.on('uncaughtException', (err) => {
  console.error('[CRASH PREVENTED]', err);
});

process.on('unhandledRejection', (err) => {
  console.error('[REJECTION PREVENTED]', err);
});

const PORT = process.env.PORT || 8100;
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const number = urlObj.searchParams.get("number");

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });

  if (isConnected) {
    return res.end(`<h2>STATUS: BOT SUDAH TERHUBUNG KE WHATSAPP!</h2>`);
  }

  if (number) {
    try {
      if (sock && !sock.authState.creds.registered) {
        let code = await sock.requestPairingCode(number.replace(/[^0-9]/g, ''));
        pairingCode = code?.match(/.{1,4}/g)?.join("-") || code;
      }
    } catch (err) {
      pairingCode = "Gagal mengambil kode: " + err.message;
    }
  }

  res.end(`
    <html>
      <head>
        <title>Pairing Bot WA</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: sans-serif; text-align: center; padding: 20px; background: #f4f4f9; }
          .card { background: white; padding: 20px; border-radius: 10px; display: inline-block; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          input, button { padding: 10px; font-size: 16px; margin: 5px; border-radius: 5px; border: 1px solid #ccc; }
          button { background: #25D366; color: white; border: none; cursor: pointer; font-weight: bold; }
          .code { font-size: 28px; font-weight: bold; color: #075e54; letter-spacing: 2px; margin-top: 15px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Pairing Bot WhatsApp</h2>
          <form method="GET">
            <input type="text" name="number" placeholder="Contoh: 628123456789" required />
            <button type="submit">Dapatkan Kode</button>
          </form>
          <div class="code">${pairingCode}</div>
        </div>
      </body>
    </html>
  `);
});

server.listen(PORT, () => {
  console.log(`Server HTTP berjalan di port ${PORT}`);
  initSocket();
});
