const express = require('express');
const cors = require('cors');

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

async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' })
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Telegram API ${response.status}: ${body}`);
  }
  return body;
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

    console.log('Sending Telegram message to chat', CHAT_ID);
    const telegramResponse = await sendTelegramMessage(text);
    console.log('Telegram response:', telegramResponse);

    res.redirect('https://kepstroy.ru/spasibo/');
  } catch (error) {
    console.error('Form handler error:', error);
    res.status(500).send(`Ошибка отправки. Пожалуйста, позвоните напрямую: +7 (978) 461-59-62 (${error.message})`);
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Form handler listening on port ${PORT}`);
});
