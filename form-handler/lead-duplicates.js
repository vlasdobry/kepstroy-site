const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHmac } = require('node:crypto');

const WINDOW_MS = 72 * 60 * 60 * 1000;
const MAX_ENTRIES = 10000;
// Identity, attribution and page changes must not turn the same request into a new lead.
const BUSINESS_FIELDS = ['service', 'message', 'comment', 'city', 'locality',
  'septic_type', 'region', 'distance', 'people', 'price', 'order_scenario',
  'object_type', 'primary_task', 'monthly_consumption', 'placement', 'panel_quantity'];
const normalizeText = value => String(value || '').normalize('NFKC')
  .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

function createDuplicateGuard({ filePath = '', now = () => Date.now() } = {}) {
  let secret = randomBytes(32).toString('hex');
  const entries = new Map();
  let healthy = true;

  if (filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    try {
      if (fs.statSync(filePath).size > 2 * 1024 * 1024) throw new Error('invalid_state');
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (saved.version !== 1 || !/^[a-f0-9]{64}$/.test(saved.secret) ||
          !Array.isArray(saved.entries) || saved.entries.length > MAX_ENTRIES ||
          saved.entries.some(row => !Array.isArray(row) || row.length !== 2 ||
            !/^[a-f0-9]{64}$/.test(row[0]) || !Number.isSafeInteger(row[1]))) {
        throw new Error('invalid_state');
      }
      secret = saved.secret;
      for (const [key, expiry] of saved.entries) if (expiry > now()) entries.set(key, expiry);
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Unable to load duplicate protection state');
    }
  }

  const fingerprint = (body, phone) => createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(JSON.stringify([phone, ...BUSINESS_FIELDS.map(key => normalizeText(body[key]))]))
    .digest('hex');

  const prune = () => {
    let changed = false;
    for (const [key, expiry] of entries) {
      if (expiry <= now()) { entries.delete(key); changed = true; }
    }
    return changed;
  };

  const persist = () => {
    if (!filePath) return;
    const temporary = `${filePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, secret, entries: [...entries] }), { mode: 0o600 });
      fs.renameSync(temporary, filePath);
      healthy = true;
    } catch {
      // A confirmed notification stays successful. Keep protection in memory and expose degradation.
      healthy = false;
      console.error('lead_duplicate_store_write_failed');
      try { fs.unlinkSync(temporary); } catch {}
    }
  };

  if (filePath) {
    // Check volume permissions before the first live lead. Periodic writes also retry a failed save.
    persist();
    const timer = setInterval(() => { prune(); persist(); }, 15 * 60 * 1000);
    timer.unref();
  }

  return {
    remaining(body, phone) {
      prune();
      return Math.max(0, (entries.get(fingerprint(body, phone)) || 0) - now());
    },
    record(body, phone) {
      prune();
      if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value);
      entries.set(fingerprint(body, phone), now() + WINDOW_MS);
      persist();
    },
    healthy: () => healthy
  };
}

module.exports = { createDuplicateGuard, normalizeText };
