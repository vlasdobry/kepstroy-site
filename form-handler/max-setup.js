const { createMaxClient } = require('./max-client');
const { deliveryConfig } = require('./lead-delivery');

function setupClient(env, fetchImpl, needsChat) {
  if (!env.MAX_BOT_TOKEN) throw new Error('missing_max_configuration');
  if (needsChat && !deliveryConfig({ MAX_BOT_TOKEN: env.MAX_BOT_TOKEN, MAX_CHAT_ID: env.MAX_CHAT_ID }).max) throw new Error('missing_max_configuration');
  return createMaxClient({ token: env.MAX_BOT_TOKEN, chatId: env.MAX_CHAT_ID, fetchImpl });
}

async function checkMax(env, fetchImpl) {
  const client = setupClient(env, fetchImpl, true);
  const me = await client.request('/me', { method: 'GET' }, true);
  const member = await client.request(`/chats/${encodeURIComponent(env.MAX_CHAT_ID)}/members/me`, { method: 'GET' }, true);
  if (!me?.is_bot || !member?.is_bot || !me.user_id || me.user_id !== member.user_id) throw new Error('max_check_failed');
  return { admin: member.is_admin === true };
}

async function runSetup(mode, env = process.env, { fetchImpl, print = console.log } = {}) {
  if (!['discover', 'check', 'send-test'].includes(mode)) throw new Error('invalid_setup_mode');
  const client = setupClient(env, fetchImpl, mode !== 'discover');
  if (mode === 'discover') {
    // One-time setup only. No production polling, no webhook subscription changes.
    const data = await client.request('/updates?types=bot_added&timeout=0&limit=100', { method: 'GET' }, true);
    if (!Array.isArray(data?.updates)) throw new Error('max_discovery_failed');
    const groups = data.updates.filter((update) => update.update_type === 'bot_added' && update.is_channel === false && /^-?\d+$/.test(update.chat_id));
    const ids = [...new Set(groups.map((update) => update.chat_id))];
    if (!ids.length) print('Событие добавления в группу не найдено. Добавьте бота в группу и повторите сразу; бот не должен быть подписан на Webhook.');
    for (const id of ids) print(`MAX_CHAT_ID=${id} (сверьте с нужной группой перед сохранением)`);
    return ids;
  }
  if (mode === 'check') {
    const result = await checkMax(env, fetchImpl);
    print('MAX: токен и членство бота в группе подтверждены; сообщений не отправлено.');
    if (!result.admin) print('Бот не администратор. Проверьте права в группе перед тестовой отправкой.');
    return result;
  }
  await client.sendLead('🧪 ТЕСТ доставки КэпСтрой. Это техническая проверка, не заявка клиента. Если сообщение видно, доставка в MAX работает.', '');
  print('MAX: тестовое сообщение подтверждено API. Проверьте его в группе.');
}

if (require.main === module) {
  runSetup(process.argv.length === 3 ? process.argv[2] : '').catch(() => {
    console.error('MAX setup failed. Режим: discover | check | send-test. Проверьте environment, модерацию, права и доступ к API; токен не передавайте аргументом.');
    process.exitCode = 1;
  });
}

module.exports = { runSetup, checkMax };
