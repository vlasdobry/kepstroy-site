const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

test('links to an existing request form record intent, unrelated anchors do not', () => {
  const events = {};
  const goals = [];
  const formSection = { matches: () => false, querySelector: () => ({}) };
  const emptySection = { matches: () => false, querySelector: () => null };
  const document = {
    referrer: '',
    querySelectorAll: () => [],
    getElementById: id => ({ main: formSection, request: formSection, equipment: emptySection })[id] || null,
    addEventListener: (event, handler) => { events[event] = handler; },
  };
  const window = {
    document,
    location: { href: 'https://kepstroy.ru/uslugi/generatory/' },
    sessionStorage: { getItem: () => null, setItem() {} },
    addEventListener() {},
    setTimeout() {},
    KepstroyAnalytics: { trackGoal: goal => goals.push(goal) },
  };
  vm.runInNewContext(readFileSync('html/js/tracking.js', 'utf8'), { window, URL });
  function click(hash) {
    const link = { getAttribute: () => hash };
    if (events.click) events.click({ target: { closest: () => link } });
  }
  click('#equipment');
  click('#missing');
  click('#main'); // A skip-link is not request intent, even if its target contains a form.
  assert.deepEqual(goals, []);
  click('#request');
  assert.deepEqual(goals, ['callback_open']);
});
