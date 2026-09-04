const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const appendIfPresent = (lines, label, value) => {
  if (value !== undefined && value !== null && String(value).trim()) {
    lines.push(`${label}: ${escapeHtml(value)}`);
  }
};

const LEAD_STATUS_LINES = {
  progress: '🕐 Взята в работу',
  done: '✅ Отработано'
};

const buildLeadStatusMessage = (text, status) => {
  let leadText = String(text ?? '');

  Object.values(LEAD_STATUS_LINES).forEach((statusLine) => {
    const suffix = `\n\n${statusLine}`;
    if (leadText.endsWith(suffix)) {
      leadText = leadText.slice(0, -suffix.length);
    }
  });

  const statusLine = LEAD_STATUS_LINES[status];
  return statusLine
    ? `${escapeHtml(leadText)}\n\n${statusLine}`
    : escapeHtml(leadText);
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

  appendIfPresent(lines, 'Тип септика', lead.septic_type);
  appendIfPresent(lines, 'Район', lead.region);
  appendIfPresent(lines, 'Расстояние до дома', lead.distance);
  appendIfPresent(lines, 'Количество проживающих', lead.people);
  appendIfPresent(lines, 'Расчётная стоимость', lead.price);

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

module.exports = { buildLeadMessage, buildLeadStatusMessage, escapeHtml };
