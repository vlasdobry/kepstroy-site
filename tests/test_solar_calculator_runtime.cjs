const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculatePanels,
  buildLeadMessage,
  resolveSolarPageCity,
  resolveSolarLocality,
  syncSolarCityField,
} = require('../html/js/solnechnye-paneli.js');
const { cities } = require('../generators/city-septik-data.json');


test('calculates nominal panel power and panel-only price', () => {
  assert.deepEqual(calculatePanels(1), {
    quantity: 1,
    powerKw: 0.65,
    panelsPrice: 20000,
  });
  assert.deepEqual(calculatePanels('10'), {
    quantity: 10,
    powerKw: 6.5,
    panelsPrice: 200000,
  });
  assert.deepEqual(calculatePanels(100), {
    quantity: 100,
    powerKw: 65,
    panelsPrice: 2000000,
  });
});


test('rejects fractional, empty and out-of-range quantities', () => {
  for (const quantity of [0, 101, 1.5, '', 'abc', null, undefined]) {
    assert.throws(
      () => calculatePanels(quantity),
      { name: 'RangeError' },
      `quantity ${String(quantity)} must be rejected`,
    );
  }
});


test('serializes the visible calculation and qualification into one lead message', () => {
  const calculation = calculatePanels(10);
  const message = buildLeadMessage({
    calculation,
    scenario: 'turnkey',
    systemType: 'hybrid',
    placement: 'roof',
    locality: 'Саки',
    comment: 'Нужно резервное питание дома',
  });

  for (const expected of [
    'Система под ключ',
    '10 панелей',
    '6,5 кВт',
    '200 000 ₽',
    'Гибридная',
    'Крыша',
    'Саки',
    'Нужно резервное питание дома',
    'Монтаж, доставка и комплектующие рассчитываются отдельно',
  ]) {
    assert.match(message, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.ok(message.length <= 1000);
});


test('restores hidden city from generated page context for all city pages', () => {
  assert.equal(cities.length, 12);
  for (const city of cities) {
    const hiddenCity = { value: 'Подменённый город' };
    const form = {
      dataset: { solarCity: city.city },
      elements: { namedItem: (name) => name === 'city' ? hiddenCity : null },
    };

    assert.equal(resolveSolarPageCity(form), city.city, city.slug);
    assert.equal(syncSolarCityField(form), city.city, city.slug);
    assert.equal(hiddenCity.value, city.city, city.slug);
  }
});


test('keeps main page city empty and tolerates an absent hidden city field', () => {
  const form = {
    dataset: {},
    elements: { namedItem: () => null },
  };

  assert.equal(resolveSolarPageCity(form), '');
  assert.equal(syncSolarCityField(form), '');
});


test('keeps city out of the free-text calculator message', () => {
  const cityForm = { dataset: { solarCity: 'Ялта' } };
  const message = buildLeadMessage({
    calculation: calculatePanels(10),
    scenario: 'turnkey',
    systemType: 'unknown',
    placement: 'consult',
    locality: resolveSolarLocality(cityForm, 'Ялта'),
    comment: '',
  });

  assert.doesNotMatch(message, /Город страницы:/);
  assert.doesNotMatch(message, /Населённый пункт: Ялта/);

  const nearbyLocality = buildLeadMessage({
    calculation: calculatePanels(10),
    scenario: 'turnkey',
    systemType: 'unknown',
    placement: 'consult',
    locality: resolveSolarLocality(cityForm, 'Гурзуф'),
    comment: '',
  });
  assert.match(nearbyLocality, /Населённый пункт: Гурзуф/);
});


test('omits empty optional locality and comment without undefined values', () => {
  const message = buildLeadMessage({
    calculation: calculatePanels(2),
    scenario: 'panels',
    systemType: 'unknown',
    placement: 'consult',
    locality: '   ',
    comment: '',
  });

  assert.match(message, /Только панели/);
  assert.match(message, /Нужна консультация/);
  assert.doesNotMatch(message, /undefined|null/);
  assert.doesNotMatch(message, /Населённый пункт:/);
  assert.doesNotMatch(message, /Комментарий:/);
});
