const fetch = require('node-fetch');

// Bound connection, headers and response body together. Never expose URL/body/token errors.
async function requestJson(url, options, { channel, fetchImpl = fetch, timeoutMs = 8000, preserveIds = false } = {}) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { ...options, signal: controller.signal, redirect: 'error', size: 1024 * 1024 });
        if (!response.ok) throw new Error('remote_http_error');
        const text = await response.text();
        // Discovery must not round JSON int64 chat IDs/markers through JS Number.
        const json = preserveIds ? text.replace(/("(?:chat_id|marker|user_id)"\s*:\s*)(-?\d+)(?=\s*[,}])/g, '$1"$2"') : text;
        return JSON.parse(json);
      })(),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('request_timeout')); }, timeoutMs);
        timer.unref();
      })
    ]);
  } catch {
    throw new Error(`${channel}_request_failed`);
  } finally {
    clearTimeout(timer);
    // Also close an error response whose body was never consumed.
    controller.abort();
  }
}

module.exports = { requestJson };
