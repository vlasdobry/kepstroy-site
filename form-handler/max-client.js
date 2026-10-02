const https = require('node:https');
const tls = require('node:tls');
const fs = require('node:fs');
const path = require('node:path');
const { requestJson } = require('./safe-request');

const API = 'https://platform-api2.max.ru';
const maxAgent = new https.Agent({
  rejectUnauthorized: true,
  ca: [...tls.rootCertificates, fs.readFileSync(path.join(__dirname, 'certs/russian-trusted-root-ca.crt'), 'utf8')]
});

function plainLead(text) {
  // buildLeadMessage emits plain labels with escaped values, not HTML tags.
  return String(text).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function createMaxClient({ token, chatId, fetchImpl, queueLimit = 10, queueTimeoutMs = 8000, deliveryTimeoutMs = 20000, delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const queue = [];
  let running = false;
  let sentBefore = false;
  const request = (route, options = {}, preserveIds = false, timeoutMs) => requestJson(`${API}${route}`, {
    ...options, agent: maxAgent, headers: { Authorization: token, 'Content-Type': 'application/json' }
  }, { channel: 'max', fetchImpl, preserveIds, timeoutMs });

  async function sendNow(text, phone) {
      const deadline = Date.now() + deliveryTimeoutMs;
      const chars = Array.from(plainLead(text));
      if (!chars.length) throw new Error('max_empty_message');
      for (let offset = 0; offset < chars.length; offset += 4000) {
        // Also pace separate leads, not just chunks, for MAX's per-chat limit.
        if (sentBefore) {
          if (deadline - Date.now() <= 510) throw new Error('max_delivery_expired');
          await delay(510);
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('max_delivery_expired');
        sentBefore = true;
        const body = { text: chars.slice(offset, offset + 4000).join('') };
        if (phone && offset + 4000 >= chars.length) {
          body.attachments = [{ type: 'inline_keyboard', payload: { buttons: [[{
            type: 'link', text: '📞 Позвонить', url: `https://kepstroy.ru/call/?phone=${encodeURIComponent(phone)}`
          }]] } }];
        }
        const data = await request(`/messages?chat_id=${encodeURIComponent(chatId)}&disable_link_preview=true`, { method: 'POST', body: JSON.stringify(body) }, false, Math.min(8000, remaining));
        if (typeof data?.message?.body?.mid !== 'string' || !data.message.body.mid) throw new Error('max_missing_confirmation');
      }
  }

  async function drain() {
    if (running) return;
    running = true;
    while (queue.length) {
      const job = queue.shift();
      clearTimeout(job.timer);
      if (Date.now() >= job.expires) { job.reject(new Error('max_queue_expired')); continue; }
      try { await sendNow(job.text, job.phone); job.resolve(); }
      catch (error) { job.reject(error); }
    }
    running = false;
  }

  function sendLead(text, phone) {
    if (queue.length >= queueLimit) return Promise.reject(new Error('max_queue_full'));
    return new Promise((resolve, reject) => {
      const job = { text, phone, resolve, reject, expires: Date.now() + queueTimeoutMs };
      job.timer = setTimeout(() => {
        const index = queue.indexOf(job);
        if (index !== -1) {
          queue.splice(index, 1);
          reject(new Error('max_queue_expired'));
        }
      }, queueTimeoutMs);
      job.timer.unref();
      queue.push(job);
      void drain();
    });
  }

  return { sendLead, request };
}

module.exports = { createMaxClient, maxAgent };
