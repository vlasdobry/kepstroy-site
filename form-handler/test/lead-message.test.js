const test = require('node:test');
const assert = require('node:assert/strict');

const { buildLeadMessage, buildLeadStatusMessage } = require('../lead-message');

const decodeTelegramHtml = (value) => value
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');

test('includes the complete traffic attribution in the Telegram lead', () => {
  const text = buildLeadMessage({
    name: 'Иван',
    phone: '+7 (978) 111-22-33',
    service: 'Септики',
    page: 'https://kepstroy.ru/uslugi/septiki/',
    message: 'Нужен расчёт',
    utm_source: 'yandex',
    utm_medium: 'cpc',
    utm_campaign: 'search_septiki',
    utm_content: 'ad_1',
    utm_term: 'септик крым',
    yclid: '123456',
    gclid: 'google-click',
    openstat: 'open-stat',
    landing_page: 'https://kepstroy.ru/?utm_source=yandex',
    original_referrer: 'https://yandex.ru/search/',
    client_id: '987654'
  });

  assert.match(text, /Иван/);
  assert.match(text, /UTM: yandex \/ cpc \/ search_septiki/);
  assert.match(text, /YCLID: 123456/);
  assert.match(text, /GCLID: google-click/);
  assert.match(text, /OpenStat: open-stat/);
  assert.match(text, /Посадочная: https:\/\/kepstroy\.ru\/\?utm_source=yandex/);
  assert.match(text, /Исходный referrer: https:\/\/yandex\.ru\/search\//);
  assert.match(text, /Client ID: 987654/);
});

test('escapes user-controlled HTML in every field', () => {
  const text = buildLeadMessage({
    name: '<b>Иван</b>',
    phone: '+7 (978) 111-22-33',
    page: 'https://kepstroy.ru/?x=<tag>'
  });

  assert.doesNotMatch(text, /<b>Иван<\/b>/);
  assert.match(text, /&lt;b&gt;Иван&lt;\/b&gt;/);
  assert.match(text, /&lt;tag&gt;/);
});

test('includes escaped calculator qualification before attribution and message', () => {
  const text = buildLeadMessage({
    service: 'Калькулятор септика',
    septic_type: '<b>Панда & Аэро</b>',
    region: '<i>Ялта</i>',
    distance: '< 15 "км"',
    people: "4' & <5>",
    price: '<strong>198 000 ₽</strong>',
    utm_source: 'yandex',
    message: 'Перезвоните'
  });

  const qualificationLines = [
    'Тип септика: &lt;b&gt;Панда &amp; Аэро&lt;/b&gt;',
    'Район: &lt;i&gt;Ялта&lt;/i&gt;',
    'Расстояние до дома: &lt; 15 &quot;км&quot;',
    'Количество проживающих: 4&#39; &amp; &lt;5&gt;',
    'Расчётная стоимость: &lt;strong&gt;198 000 ₽&lt;/strong&gt;'
  ];

  qualificationLines.forEach((line) => assert.match(text, new RegExp(line)));
  assert.doesNotMatch(text, /<(?:b|i|strong)>/);

  const servicePosition = text.indexOf('Услуга:');
  const attributionPosition = text.indexOf('UTM:');
  const messagePosition = text.indexOf('Сообщение:');
  let previousPosition = servicePosition;

  qualificationLines.forEach((line) => {
    const position = text.indexOf(line);
    assert.ok(position > previousPosition);
    previousPosition = position;
  });

  assert.ok(attributionPosition > previousPosition);
  assert.ok(messagePosition > attributionPosition);
});

test('omits blank qualification values but preserves numeric zero', () => {
  const text = buildLeadMessage({
    septic_type: undefined,
    region: null,
    distance: '',
    people: '   ',
    price: 0
  });

  assert.doesNotMatch(text, /Тип септика:/);
  assert.doesNotMatch(text, /Район:/);
  assert.doesNotMatch(text, /Расстояние до дома:/);
  assert.doesNotMatch(text, /Количество проживающих:/);
  assert.match(text, /Расчётная стоимость: 0/);
});

test('keeps literal user HTML escaped across Telegram status round trips', () => {
  const initialPayload = buildLeadMessage({ name: '<b>Иван & Ко</b>' });
  const firstCallbackText = decodeTelegramHtml(initialPayload);

  const progressPayload = buildLeadStatusMessage(firstCallbackText, 'progress');

  assert.match(progressPayload, /&lt;b&gt;Иван &amp; Ко&lt;\/b&gt;/);
  assert.doesNotMatch(progressPayload, /<b>Иван & Ко<\/b>/);

  const secondCallbackText = decodeTelegramHtml(progressPayload);
  const donePayload = buildLeadStatusMessage(secondCallbackText, 'done');

  assert.match(donePayload, /&lt;b&gt;Иван &amp; Ко&lt;\/b&gt;/);
  assert.doesNotMatch(donePayload, /<b>Иван & Ко<\/b>/);
  assert.doesNotMatch(donePayload, /&amp;lt;b&amp;gt;/);
  assert.doesNotMatch(donePayload, /Взята в работу/);
  assert.match(donePayload, /✅ Отработано$/);
});

test('preserves a user-provided done suffix when adding progress status', () => {
  const initialPayload = buildLeadMessage({
    message: 'Пользовательский текст\n\n✅ Отработано'
  });
  const callbackText = decodeTelegramHtml(initialPayload);

  const progressPayload = buildLeadStatusMessage(callbackText, 'progress');

  assert.equal((progressPayload.match(/✅ Отработано/g) || []).length, 1);
  assert.match(progressPayload, /💬 Сообщение: Пользовательский текст\n\n✅ Отработано/);
  assert.match(progressPayload, /🕐 Взята в работу$/);
});

test('preserves a user progress suffix while replacing only the appended progress status', () => {
  const initialPayload = buildLeadMessage({
    message: 'Пользовательский текст\n\n🕐 Взята в работу'
  });
  const firstCallbackText = decodeTelegramHtml(initialPayload);
  const progressPayload = buildLeadStatusMessage(firstCallbackText, 'progress');

  assert.equal((progressPayload.match(/🕐 Взята в работу/g) || []).length, 2);

  const secondCallbackText = decodeTelegramHtml(progressPayload);
  const donePayload = buildLeadStatusMessage(secondCallbackText, 'done');

  assert.equal((donePayload.match(/🕐 Взята в работу/g) || []).length, 1);
  assert.equal((donePayload.match(/✅ Отработано/g) || []).length, 1);
  assert.match(donePayload, /💬 Сообщение: Пользовательский текст\n\n🕐 Взята в работу/);
  assert.match(donePayload, /✅ Отработано$/);
});
