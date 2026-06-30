const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const appendIfPresent = (lines, label, value) => {
  if (value) lines.push(`${label}: ${escapeHtml(value)}`);
};

const buildLeadMessage = (lead) => {
  const lines = [
    '🚀 Новая заявка с сайта КэпСтрой',
    '',
    `👤 Имя: ${escapeHtml(lead.name || '—')}`,
    `📞 Телефон: ${escapeHtml(lead.phone || '—')}`,
    `🔧 Услуга: ${escapeHtml(lead.service || '—')}`,
    `🌐 Страница: ${escapeHtml(lead.current_page || lead.page || '—')}`
  ];

  if (lead.utm_source || lead.utm_medium || lead.utm_campaign || lead.utm_content || lead.utm_term) {
    lines.push(
      `📊 UTM: ${escapeHtml(lead.utm_source || '-')} / ${escapeHtml(lead.utm_medium || '-')} / ${escapeHtml(lead.utm_campaign || '-')} / content: ${escapeHtml(lead.utm_content || '-')} / term: ${escapeHtml(lead.utm_term || '-')}`
    );
  }

  appendIfPresent(lines, '🟡 YCLID', lead.yclid);
  appendIfPresent(lines, '🔵 GCLID', lead.gclid);
  appendIfPresent(lines, '📎 OpenStat', lead.openstat);
  appendIfPresent(lines, '🚪 Посадочная', lead.landing_page);
  appendIfPresent(lines, '↩️ Исходный referrer', lead.original_referrer);
  appendIfPresent(lines, '🆔 Client ID', lead.client_id);
  appendIfPresent(lines, '💬 Сообщение', lead.message);

  return lines.join('\n');
};

module.exports = { buildLeadMessage, escapeHtml };