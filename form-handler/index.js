const express = require('express');
const cors = require('cors');
const https = require('https');

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

function sendTelegramMessage(text) {
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
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`Telegram API ${res.statusCode}: ${body}`));
        }
      });
    });
    req.on('error', reject);
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

    await sendTelegramMessage(text);
    res.redirect('https://kepstroy.ru/spasibo/');
  } catch (error) {
    console.error('Form handler error:', error.message);
    res.status(500).send('Ошибка отправки. Пожалуйста, позвоните напрямую: +7 (978) 461-59-62');
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Form handler listening on port ${PORT}`);
});
