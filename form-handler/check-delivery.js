const { HttpsProxyAgent } = require('https-proxy-agent');
const { requestJson } = require('./safe-request');
const { deliveryConfig, deliverLead } = require('./lead-delivery');
const { checkMax } = require('./max-setup');

// Read-only deploy gate. Does not create a fake lead or send a message.
async function checkDelivery(env = process.env, fetchImpl, report) {
  const config = deliveryConfig(env);
  return deliverLead({
    ...(config.telegram ? { telegram: async () => {
      const data = await requestJson(`https://api.telegram.org/bot${env.BOT_TOKEN}/getMe`, {
        method: 'GET', agent: env.TELEGRAM_PROXY_URL ? new HttpsProxyAgent(env.TELEGRAM_PROXY_URL) : undefined
      }, { channel: 'telegram', fetchImpl });
      if (data?.ok !== true || data.result?.is_bot !== true) throw new Error('telegram_check_failed');
    } } : {}),
    ...(config.max ? { max: () => checkMax(env, fetchImpl) } : {})
  }, report);
}

if (require.main === module) {
  checkDelivery().catch(() => { console.error('No configured delivery channel passed connectivity checks'); process.exitCode = 1; });
}

module.exports = { checkDelivery };
