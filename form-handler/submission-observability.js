const { randomUUID } = require('node:crypto');

const REASONS = new Set(['invalid_source', 'bot_check', 'invalid_form', 'rejected_content',
  'invalid_phone', 'rate_limit', 'delivery_failed', 'invalid_payload', 'payload_too_large',
  'test_ignored', 'delivered', 'request_aborted', 'internal_error']);

function formKind(body) {
  if (typeof body?.service !== 'string') return 'other';
  return /^Солнечные панели(?: и электростанции)?$/.test(body.service) ? 'solar' : 'other';
}

function observeSubmission(req, res, next) {
  if (req.method !== 'POST' || req.path !== '/submit') return next();
  const started = Date.now();
  const requestId = randomUUID();
  res.locals.submission = { requestId, reason: null };
  res.setHeader('X-Request-ID', requestId);
  let recorded = false;
  const record = aborted => {
    if (recorded) return;
    recorded = true;
    const reason = aborted ? 'request_aborted' : res.locals.submission.reason || 'internal_error';
    console.log(JSON.stringify({ event: 'form_submission', request_id: requestId,
      form: formKind(req.body), http_status: aborted ? 0 : res.statusCode,
      reason, outcome: aborted ? 'unknown' : reason === 'delivered' ? 'delivered' : reason === 'test_ignored' ? 'ignored' : 'rejected',
      duration_ms: Math.max(0, Date.now() - started) }));
  };
  res.once('finish', () => record(false));
  res.once('close', () => { if (!res.writableFinished) record(true); });
  next();
}

function submissionResult(res, reason) {
  const state = res.locals.submission;
  if (!state) return;
  state.reason = REASONS.has(reason) ? reason : 'internal_error';
  if (!['delivered', 'test_ignored'].includes(state.reason)) res.setHeader('X-Form-Error', state.reason);
}

function reportSubmissionChannel(res, event) {
  if (!res.locals.submission || !['max', 'telegram'].includes(event.channel) ||
      !['confirmed', 'failed'].includes(event.status)) return;
  console.log(JSON.stringify({ event: 'form_delivery', request_id: res.locals.submission.requestId,
    channel: event.channel, status: event.status }));
}

function submissionErrorHandler(error, req, res, next) {
  if (!res.locals.submission || res.headersSent) return next(error);
  const oversized = error.type === 'entity.too.large';
  const corsDenied = error.message === 'CORS origin denied';
  const payloadError = ['entity.parse.failed', 'entity.too.large', 'parameters.too.many',
    'charset.unsupported', 'encoding.unsupported', 'request.aborted', 'request.size.invalid'].includes(error.type);
  submissionResult(res, oversized ? 'payload_too_large' : corsDenied ? 'invalid_source' : payloadError ? 'invalid_payload' : 'internal_error');
  res.status(oversized ? 413 : corsDenied ? 403 : payloadError ? 400 : 500).send('Некорректный запрос');
}

module.exports = { observeSubmission, submissionResult, reportSubmissionChannel, submissionErrorHandler };
