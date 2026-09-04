const test = require('node:test');
const assert = require('node:assert/strict');

const { buildLeadMessage } = require('../lead-message');

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
