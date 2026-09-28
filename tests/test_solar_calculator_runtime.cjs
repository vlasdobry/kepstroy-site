const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculatePanels,
  createSolarQualification,
  buildLeadMessage,
  readSolarCalculatorConfig,
  resolveSolarPageCity,
  syncSolarCityField,
} = require('../html/js/solnechnye-paneli.js');
const { cities } = require('../generators/city-septik-data.json');
const offer = require('../generators/solar-page-data.json');

const defaultConfig = {
  panelPowerW: offer.panel_power_w,
  panelPriceRub: offer.panel_price_rub,
};


test('calculates nominal panel power and panel-only price', () => {
  assert.deepEqual(calculatePanels(1, defaultConfig), {
    quantity: 1,
    panelPowerKw: 0.65,
    powerKw: 0.65,
    panelsPrice: 20000,
  });
  assert.deepEqual(calculatePanels('10', defaultConfig), {
    quantity: 10,
    panelPowerKw: 0.65,
    powerKw: 6.5,
    panelsPrice: 200000,
  });
  assert.deepEqual(calculatePanels(100, defaultConfig), {
    quantity: 100,
    panelPowerKw: 0.65,
    powerKw: 65,
    panelsPrice: 2000000,
  });
});


test('reads positive finite calculator config and follows changed offer values', () => {
  const config = readSolarCalculatorConfig({
    dataset: { panelPowerW: '720', panelPriceRub: '23456' },
  });
  const calculation = calculatePanels(10, config);

  assert.deepEqual(calculation, {
    quantity: 10,
    panelPowerKw: 0.72,
    powerKw: 7.2,
    panelsPrice: 234560,
  });
  const qualification = createSolarQualification({
    scenario: 'panels',
    objectType: 'house',
    primaryTask: 'panels',
    monthlyConsumption: 'unknown',
    placement: 'roof',
    panelQuantity: '10',
  }, config);
  assert.match(
    buildLeadMessage({ qualification, comment: '' }),
    /0,72 × 10 = 7,2 кВт[\s\S]*234 560 ₽/,
  );
});


test('rejects missing, non-finite and non-positive calculator config', () => {
  for (const dataset of [
    {},
    { panelPowerW: '0', panelPriceRub: '20000' },
    { panelPowerW: '650', panelPriceRub: '-1' },
    { panelPowerW: 'Infinity', panelPriceRub: '20000' },
    { panelPowerW: '650', panelPriceRub: 'not-a-number' },
  ]) {
    assert.throws(
      () => readSolarCalculatorConfig({ dataset }),
      { name: 'RangeError' },
      JSON.stringify(dataset),
    );
  }
});


test('rejects fractional, empty and out-of-range quantities', () => {
  for (const quantity of [0, 101, 1.5, '', 'abc', null, undefined]) {
    assert.throws(
      () => calculatePanels(quantity, defaultConfig),
      { name: 'RangeError' },
      `quantity ${String(quantity)} must be rejected`,
    );
  }
});


test('creates a task-first turnkey qualification without an invented panel quote', () => {
  const qualification = createSolarQualification({
    scenario: 'turnkey',
    objectType: 'house',
    primaryTask: 'backup',
    monthlyConsumption: 'bill',
    placement: 'roof',
    panelQuantity: '10',
  }, defaultConfig);
  const message = buildLeadMessage({
    qualification,
    locality: 'Саки',
    comment: 'Нужно резервное питание дома',
  });

  for (const expected of [
    'Система под ключ',
    'Частный дом',
    'Резерв при отключениях',
    'Есть квитанция за электричество',
    'Крыша',
    'Нужно резервное питание дома',
    'Состав и стоимость системы уточняются после проверки исходных данных',
  ]) {
    assert.match(message, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(message, /Населённый пункт:/);
  assert.doesNotMatch(message, /Саки/);
  assert.doesNotMatch(message, /10 панелей|6,5 кВт|200 000 ₽/);
  assert.equal(qualification.panelCalculation, null);
  assert.ok(message.length <= 1000);
});


test('adds a confirmed panel-only calculation only for a panels request', () => {
  const qualification = createSolarQualification({
    scenario: 'panels',
    objectType: 'business',
    primaryTask: 'panels',
    monthlyConsumption: 'unknown',
    placement: 'consult',
    panelQuantity: '4',
  }, defaultConfig);
  const message = buildLeadMessage({ qualification, comment: '' });

  assert.deepEqual(qualification.panelCalculation, {
    quantity: 4,
    panelPowerKw: 0.65,
    powerKw: 2.6,
    panelsPrice: 80000,
  });
  assert.match(message, /Только панели/);
  assert.match(message, /0,65 × 4 = 2,6 кВт/);
  assert.match(message, /Стоимость панелей: 80 000 ₽/);
});


test('allows an unknown panel quantity and validates it only for a panels request', () => {
  const unknown = createSolarQualification({
    scenario: 'panels',
    objectType: 'other',
    primaryTask: 'panels',
    monthlyConsumption: 'unknown',
    placement: 'consult',
    panelQuantity: '',
  }, defaultConfig);
  assert.equal(unknown.panelCalculation, null);
  assert.match(buildLeadMessage({ qualification: unknown, comment: '' }), /Количество панелей: уточнить/);

  assert.throws(
    () => createSolarQualification({ scenario: 'panels', panelQuantity: '101' }, defaultConfig),
    { name: 'RangeError' },
  );
  assert.doesNotThrow(
    () => createSolarQualification({ scenario: 'turnkey', panelQuantity: '101' }, defaultConfig),
  );
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


test('keeps city and locality out of the free-text calculator message', () => {
  const qualification = createSolarQualification({
    scenario: 'turnkey',
    objectType: 'house',
    primaryTask: 'backup',
    monthlyConsumption: 'unknown',
    placement: 'consult',
    panelQuantity: '',
  }, defaultConfig);
  const message = buildLeadMessage({
    qualification,
    locality: 'Ялта',
    comment: '',
  });

  assert.doesNotMatch(message, /Город страницы:/);
  assert.doesNotMatch(message, /Населённый пункт: Ялта/);

  const nearbyLocality = buildLeadMessage({
    qualification,
    locality: 'Гурзуф',
    comment: '',
  });
  assert.doesNotMatch(nearbyLocality, /Населённый пункт:/);
  assert.doesNotMatch(nearbyLocality, /Гурзуф/);
});


test('omits empty optional locality and comment without undefined values', () => {
  const qualification = createSolarQualification({
    scenario: 'panels',
    objectType: 'other',
    primaryTask: 'panels',
    monthlyConsumption: 'unknown',
    placement: 'consult',
    panelQuantity: '2',
  }, defaultConfig);
  const message = buildLeadMessage({
    qualification,
    locality: '   ',
    comment: '',
  });

  assert.match(message, /Только панели/);
  assert.match(message, /Другой объект/);
  assert.doesNotMatch(message, /undefined|null/);
  assert.doesNotMatch(message, /Населённый пункт:/);
  assert.doesNotMatch(message, /Комментарий:/);
});
