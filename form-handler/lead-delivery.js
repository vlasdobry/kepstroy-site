function deliveryConfig(env) {
  const configured = (token, id) => {
    if (!token && !id) return false;
    if (!token || !id || !/^-?\d+$/.test(id) || BigInt(id) < -(2n ** 63n) || BigInt(id) >= 2n ** 63n) {
      throw new Error('invalid_delivery_configuration');
    }
    return true;
  };
  return { telegram: configured(env.BOT_TOKEN, env.CHAT_ID), max: configured(env.MAX_BOT_TOKEN, env.MAX_CHAT_ID) };
}

async function deliverLead(channels, report = (event) => console.log('Lead delivery:', event)) {
  const attempts = Object.entries(channels).map(([channel, send]) => Promise.resolve().then(send).then(() => {
    report({ channel, status: 'confirmed' });
    return channel;
  }, () => {
    report({ channel, status: 'failed' });
    throw new Error('channel_failed');
  }));
  try {
    return await Promise.any(attempts);
  } catch {
    throw new Error('delivery_failed');
  }
}

module.exports = { deliveryConfig, deliverLead };
