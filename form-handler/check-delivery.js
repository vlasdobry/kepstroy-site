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
  // This one-shot, read-only CLI is done once any channel is verified.
  // A proxy TCP handshake can outlive fetch abort; it must not hold the gate.
  // Flush the final line before exiting. The long-running form server is untouched.
  checkDelivery().then(
    () => process.stdout.write('Messenger connectivity check passed\n', () => process.exit(0)),
    () => process.stderr.write('No configured delivery channel passed connectivity checks\n', () => process.exit(1))
  );
}

module.exports = { checkDelivery };
