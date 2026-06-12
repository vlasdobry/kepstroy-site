const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
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

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const PROXY_URL = process.env.TELEGRAM_PROXY_URL;

const telegramAgent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;

function cleanPhone(phone) {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
}

function formatPhone(phone) {
  const digits = cleanPhone(phone);
  if (digits.length === 11 && digits.startsWith('7')) {
    return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
  }
  if (digits.length === 10) {
    return `+7 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 10)}`;
  }
  return phone || '—';
}

async function callTelegramAPI(method, body) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    agent: telegramAgent,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Telegram API ${method} ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

function callButton(digits) {
  return { text: '📞 Позвонить', url: `https://kepstroy.ru/call/?phone=${digits}` };
}

function takeButton(digits) {
  return { text: '🕐 Взять в работу', callback_data: `lead_progress:${digits}` };
}

function doneButton(digits) {
  return { text: '✅ Отработано', callback_data: `lead_done:${digits}` };
}

async function sendTelegramMessage(text, phone) {
  const digits = cleanPhone(phone);
  const payload = {
    chat_id: CHAT_ID,
    text,
    parse_mode: 'HTML'
  };
  if (digits) {
    payload.reply_markup = {
      inline_keyboard: [
        [callButton(digits), takeButton(digits)]
      ]
    };
  }
  return callTelegramAPI('sendMessage', payload);
}

async function answerCallback(callbackQueryId, text) {
  return callTelegramAPI('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text
  });
}

async function editMessageStatus(chatId, messageId, text, status, phone) {
  const digits = cleanPhone(phone);
  let statusLine = '';
  let keyboard = [];

  if (status === 'progress') {
    statusLine = '🕐 Взята в работу';
    if (digits) {
      keyboard = [[callButton(digits), doneButton(digits)]];
    }
  } else if (status === 'done') {
    statusLine = '✅ Отработано';
    if (digits) {
      keyboard = [[callButton(digits)]];
    }
  }

  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: `${text}\n\n${statusLine}`,
    parse_mode: 'HTML'
  };
  if (keyboard.length) {
    payload.reply_markup = { inline_keyboard: keyboard };
  }
  return callTelegramAPI('editMessageText', payload);
}

async function handleCallback(callbackQuery) {
  const data = callbackQuery.data || '';
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const messageText = callbackQuery.message.text;

  if (data.startsWith('lead_progress:')) {
    const phone = data.replace('lead_progress:', '');
    await editMessageStatus(chatId, messageId, messageText, 'progress', phone);
    try {
      await answerCallback(callbackQuery.id, 'Заявка взята в работу');
    } catch (err) {
      console.error('answerCallbackQuery failed (ignored):', err.message);
    }
    console.log('Lead taken in progress:', phone);
    return;
  }

  if (data.startsWith('lead_done:')) {
    const phone = data.replace('lead_done:', '');
    await editMessageStatus(chatId, messageId, messageText, 'done', phone);
    try {
      await answerCallback(callbackQuery.id, 'Заявка отмечена как отработана');
    } catch (err) {
      console.error('answerCallbackQuery failed (ignored):', err.message);
    }
    console.log('Lead marked as done:', phone);
  }
}

app.post('/submit', async (req, res) => {
  try {
    const { name, phone, service, page, message } = req.body;

    // Basic spam honeypot: if "website" field is present and filled, reject
    if (req.body.website) {
      return res.status(400).send('Spam detected');
    }

    const utmSource = req.body.utm_source;
    const utmMedium = req.body.utm_medium;
    const utmCampaign = req.body.utm_campaign;
    const utmContent = req.body.utm_content;
    const utmTerm = req.body.utm_term;
    const clientId = req.body.client_id;
    const referrer = req.body.referrer;

    const phoneDisplay = formatPhone(phone);

    let text = `🚀 Новая заявка с сайта КэпСтрой\n\n`;
    text += `👤 Имя: ${name || '—'}\n`;
    text += `📞 Телефон: ${phoneDisplay}\n`;
    text += `🔧 Услуга: ${service || '—'}\n`;
    text += `🌐 Страница: ${page || '—'}`;
    if (utmSource || utmMedium || utmCampaign || utmContent || utmTerm) {
      text += `\n📊 UTM: ${utmSource || '-'} / ${utmMedium || '-'} / ${utmCampaign || '-'} / content: ${utmContent || '-'} / term: ${utmTerm || '-'}`;
    }
    if (clientId) {
      text += `\n🆔 Client ID: ${clientId}`;
    }
    if (referrer) {
      text += `\n↩️ Referrer: ${referrer}`;
    }
    if (message) {
      text += `\n💬 Сообщение: ${message}`;
    }

    await sendTelegramMessage(text, phone);
    res.redirect('https://kepstroy.ru/spasibo/');
  } catch (error) {
    console.error('Form handler error:', error);
    res.status(500).send('Ошибка отправки. Пожалуйста, позвоните напрямую: +7 (978) 461-59-62');
  }
});

app.post('/webhook', async (req, res) => {
  try {
    const callbackQuery = req.body.callback_query;
    if (callbackQuery) {
      await handleCallback(callbackQuery);
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(200);
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

async function pollUpdates(offset = 0) {
  try {
    const data = await callTelegramAPI('getUpdates', { offset, limit: 10 });
    if (data.ok && data.result) {
      for (const update of data.result) {
        offset = update.update_id + 1;
        const callbackQuery = update.callback_query;
        if (callbackQuery && callbackQuery.data) {
          await handleCallback(callbackQuery);
        }
      }
    }
  } catch (err) {
    console.error('Polling error:', err.message);
  }
  setTimeout(() => pollUpdates(offset), 5000);
}

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('Missing BOT_TOKEN or CHAT_ID environment variables');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Form handler listening on port ${PORT}`);
  pollUpdates();
});
