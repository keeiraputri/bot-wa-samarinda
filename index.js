const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const http = require('http');
const axios = require('axios');

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

async function keepTyping(jid, durationMs = 4000) {
  const intervalMs = 1500;
  const startTime = Date.now();
  
  while (Date.now() - startTime < durationMs) {
    try {
      await sock.sendPresenceUpdate('composing', jid);
    } catch (e) {}
    const remaining = durationMs - (Date.now() - startTime);
    if (remaining > 0) {
      await sleep(Math.min(intervalMs, remaining));
    }
  }
}

function getGreeting() {
  const hour = new Date().toLocaleString("en-US", { timeZone: "Asia/Makassar", hour: 'numeric', hour12: false });
  const h = parseInt(hour, 10);

  if (h >= 5 && h < 11) {
    return "Selamat pagi";
  } else if (h >= 11 && h < 15) {
    return "Selamat siang";
  } else if (h >= 15 && h < 18) {
    return "Selamat sore";
  } else {
    return "Selamat malam";
  }
}

async function askAI(promptText) {
  const greeting = getGreeting();
  const groqKey = process.env.GROQ_API_KEY || "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";

  try {
    const systemInstruction = `Kamu adalah asisten virtual AI cerdas yang ramah dan profesional. Selalu awali jawaban pertamamu dengan ucapan "${greeting}". Jawablah pertanyaan pengguna secara singkat, jelas, dan ramah.`;

    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: promptText }
        ],
        temperature: 0.5,
        max_tokens: 500
      },
      {
        headers: {
          "Authorization": `Bearer ${groqKey}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    return response.data?.choices?.[0]?.message?.content || `${greeting}! Ada yang bisa saya bantu?`;
  } catch (err) {
    console.error("Groq API Error Detail:", err.response?.data || err.message);

    // Jawaban pintar cadangan jika hitungan matematika sederhana
    if (promptText.includes('x') || promptText.includes('*') || promptText.includes('+') || promptText.includes('-')) {
      try {
        const expr = promptText.replace(/x/g, '*');
        if (/^[0-9\s\+\-\*\/\.\(\)]+$/.test(expr)) {
          const res = eval(expr);
          return `${greeting}! Hasil dari ${promptText} adalah ${res}`;
        }
      } catch (e) {}
    }

    return `${greeting}! Halo, ada yang bisa saya bantu terkait layanan kami?`;
  }
}

async function initSocket() {
  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ["Ubuntu", "Chrome", "20.0.04"]
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      isConnected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 408) {
        clearAuth();
      }
      setTimeout(() => initSocket(), 5000);
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
      const greeting = getGreeting();

      // Kata kunci SPESIFIK untuk jasa pembangunan/renovasi rumah
      const homeKeywords = ['renovasi', 'bangun rumah', 'atap bocor', 'tukang bangunan', 'borongan rumah', 'cat rumah', 'pasang semen'];
      const isHomeService = homeKeywords.some(kw => textLower.includes(kw));

      if (isHomeService) {
        await keepTyping(from, 4000);
        await sock.sendPresenceUpdate('paused', from);
        await sock.sendMessage(from, { 
          text: `${greeting}! Sabar ya sebentar lagi dibalas mungkin masih sibuk atau hp di cas. Terima kasih!` 
        });
      } else {
        const replyPromise = askAI(body);
        const typingPromise = keepTyping(from, 4000);

        const [reply] = await Promise.all([replyPromise, typingPromise]);
        
        await sock.sendPresenceUpdate('paused', from);
        await sock.sendMessage(from, { text: reply });
      }
    } catch (generalErr) {
      console.error("Error handling message:", generalErr);
    }
  });
}

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
