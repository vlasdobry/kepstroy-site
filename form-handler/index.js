const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { buildLeadMessage } = require('./lead-message');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

const ALLOWED_ORIGINS = new Set(['https://kepstroy.ru', 'https://www.kepstroy.ru']);
const ALLOWED_HOSTS = new Set(['kepstroy.ru', 'www.kepstroy.ru']);

// Allow CORS from the website. CORS is not anti-spam; server-side checks below do that.
app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.has(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('CORS origin denied'));
  },
  methods: ['POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.urlencoded({ extended: true, limit: '20kb' }));
app.use(express.json({ limit: '20kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const PROXY_URL = process.env.TELEGRAM_PROXY_URL;

const telegramAgent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;

// In-memory rate limiting storage. Enough for a single small container.
const recentSubmissions = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const PHONE_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SUBMISSIONS_PER_IP = 3;
const MAX_FIELD_LENGTH = 1000;
const TEST_PHONE = '79999999999';
const TEST_NAME = 'CI Test';
const TEST_MESSAGE = 'CI test';
const SPAM_PATTERNS = [
  /\bhttps?:\/\//i,
  /\bt\.me\//i,
  /\btelegram\b/i,
  /\bwhatsapp\b/i,
  /\bgoogle\s*search\s*index\b/i,
  /\bsearchregister\b/i,
  /\bregister\s+.+\s+now\b/i,
  /провер(?:ка|ки)\s+контрагент/i,
  /книг[аи]\s+покупок/i,
  /книг[аи]\s+продаж/i
];

function cleanPhone(phone) {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
}

function normalizePhone(phone) {
  const digits = cleanPhone(phone);
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

function isLikelyRussianLeadPhone(phone) {
  const digits = normalizePhone(phone);
  if (!/^7\d{10}$/.test(digits)) return false;

  const national = digits.slice(1);
  return national.startsWith('9') ||
         national.startsWith('365') ||
         national.startsWith('869');
}

function formatPhone(phone) {
  const digits = normalizePhone(phone);
  if (digits.length === 11 && digits.startsWith('7')) {
    return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
  }
  return phone || '—';
}

function isTestSubmission(body) {
  return body.name === TEST_NAME ||
         normalizePhone(body.phone) === TEST_PHONE ||
         body.message === TEST_MESSAGE;
}

function getClientIp(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function cleanupOldSubmissions() {
  const now = Date.now();
  for (const [key, value] of recentSubmissions) {
    const timestamp = value.timestamp || value;
    if (now - timestamp > RATE_LIMIT_WINDOW_MS) {
      recentSubmissions.delete(key);
    }
  }
}

function isRateLimited(ip, phone) {
  cleanupOldSubmissions();
  const now = Date.now();
  const ipKey = `ip:${ip}`;
  const phoneKey = `phone:${normalizePhone(phone)}`;

  const ipEntry = recentSubmissions.get(ipKey);
  if (ipEntry && ipEntry.count >= MAX_SUBMISSIONS_PER_IP) {
    return true;
  }

  const phoneLast = recentSubmissions.get(phoneKey);
  if (phoneLast && now - phoneLast < PHONE_COOLDOWN_MS) {
    return true;
  }

  return false;
}

function recordSubmission(ip, phone) {
  const now = Date.now();
  const ipKey = `ip:${ip}`;
  const phoneKey = `phone:${normalizePhone(phone)}`;

  const ipEntry = recentSubmissions.get(ipKey);
  recentSubmissions.set(ipKey, {
    count: (ipEntry?.count || 0) + 1,
    timestamp: now
  });
  recentSubmissions.set(phoneKey, now);
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


function hasValidBrowserSource(req) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) return true;

  const referer = req.headers.referer || req.headers.referrer;
  if (!referer) return false;

  try {
    return ALLOWED_HOSTS.has(new URL(referer).hostname);
  } catch {
    return false;
  }
}

function hasSuspiciousContent(body) {
  const text = ['name', 'service', 'message']
    .map((key) => body[key] || '')
    .join('\n');
  return SPAM_PATTERNS.some((pattern) => pattern.test(text));
}

function hasOversizedField(body) {
  return Object.values(body).some((value) => String(value || '').length > MAX_FIELD_LENGTH);
}

function fieldHasValue(value) {
  if (Array.isArray(value)) {
    return value.some((item) => String(item || '').trim().length > 0);
  }
  return String(value || '').trim().length > 0;
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
  const digits = normalizePhone(phone);
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
  const digits = normalizePhone(phone);
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

    if (!hasValidBrowserSource(req)) {
      console.log('Submission rejected: invalid browser source', {
        ip: getClientIp(req),
        origin: req.headers.origin,
        referer: req.headers.referer || req.headers.referrer
      });
      return res.status(403).send('Forbidden');
    }

    // Honeypots: real users never fill these fields.
    if (fieldHasValue(req.body.website) || fieldHasValue(req.body.company)) {
      return res.status(400).send('Spam detected');
    }

    if (req.body.form_source !== 'kepstroy') {
      return res.status(400).send('Invalid form');
    }

    if (hasOversizedField(req.body) || hasSuspiciousContent(req.body)) {
      console.log('Submission rejected: suspicious content', {
        ip: getClientIp(req),
        phone,
        service,
        page
      });
      return res.status(400).send('Spam detected');
    }

    // Ignore CI test submissions but still return success
    if (isTestSubmission(req.body)) {
      console.log('CI test submission ignored:', { name, phone, message });
      return res.redirect('https://kepstroy.ru/spasibo/');
    }

    const digits = normalizePhone(phone);
    if (!isLikelyRussianLeadPhone(phone)) {
      return res.status(400).send('Некорректный номер телефона');
    }

    const clientIp = getClientIp(req);
    if (isRateLimited(clientIp, phone)) {
      console.log('Rate limit exceeded:', { clientIp, phone });
      return res.status(429).send('Слишком много заявок. Пожалуйста, подождите.');
    }

    const phoneDisplay = formatPhone(phone);
    const text = buildLeadMessage({
      ...req.body,
      phone: phoneDisplay
    });

    await sendTelegramMessage(text, digits);
    recordSubmission(clientIp, phone);
    res.redirect('https://kepstroy.ru/spasibo/');
  } catch (error) {
    console.error('Form handler error:', error);
    res.status(500).send('Ошибка отправки. Пожалуйста, позвоните напрямую: +7 (978) 461-59-62');
  }
});

app.post('/webhook', async (req, res) => {
  try {
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expectedSecret || req.headers['x-telegram-bot-api-secret-token'] !== expectedSecret) {
      return res.sendStatus(404);
    }

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
