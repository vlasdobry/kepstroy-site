const express = require('express');
const cors = require('cors');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();

// Allow CORS from the website
app.use(cors({
  origin: ['https://kepstroy.ru', 'https://www.kepstroy.ru'],
  methods: ['POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN || '8873033823:AAFyZpFOTmj5UWwqTMM67wNXpik2Qr0qPfU';
const CHAT_ID = process.env.CHAT_ID || '-5215921734';
const PROXY_URL = process.env.TELEGRAM_PROXY_URL;

function sendTelegramMessage(text, family = 0) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      chat_id: CHAT_ID,
      text: text,
      parse_mode: 'HTML'
    });
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname,
      method: 'POST',
      family,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    if (PROXY_URL) {
      options.agent = new HttpsProxyAgent(PROXY_URL);
    }
    console.log('Sending Telegram request to', parsedUrl.hostname, 'family:', family, 'proxy:', PROXY_URL ? 'yes' : 'no');
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log('Telegram response status:', res.statusCode, 'body:', body);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`Telegram API ${res.statusCode}: ${body}`));
        }
      });
    });
    req.on('error', (err) => {
      console.error('Telegram request error:', err);
      reject(err);
    });
    req.write(data);
    req.end();
  });
}

app.post('/submit', async (req, res) => {
  try {
    const { name, phone, service, page, message } = req.body;

    // Basic spam honeypot: if "website" field is present and filled, reject
    if (req.body.website) {
      return res.status(400).send('Spam detected');
    }

    let text = `🚀 Новая заявка с сайта КэпСтрой\n\n`;
    text += `👤 Имя: ${name || '—'}\n`;
    text += `📞 Телефон: ${phone || '—'}\n`;
    text += `🔧 Услуга: ${service || '—'}\n`;
    text += `🌐 Страница: ${page || '—'}`;
    if (message) {
      text += `\n💬 Сообщение: ${message}`;
    }

    try {
      await sendTelegramMessage(text, 4);
    } catch (err) {
      if ((err.code === 'ETIMEDOUT' || err.code === 'ENETUNREACH') && PROXY_URL) {
        console.log('IPv4 failed via proxy, trying without proxy...');
        await sendTelegramMessage(text, 4);
      } else {
        throw err;
      }
    }

    res.redirect('https://kepstroy.ru/spasibo/');
  } catch (error) {
    console.error('Form handler error:', error);
    res.status(500).send(`Ошибка отправки. Пожалуйста, позвоните напрямую: +7 (978) 461-59-62 (${error.code || error.message})`);
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Form handler listening on port ${PORT}`);
});
