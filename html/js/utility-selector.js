(function () {
  'use strict';
  const root = document.querySelector('[data-utility-selector]');
  if (!root) return;
  const service = root.dataset.utilitySelector;
  if (!['water', 'sewer'].includes(service)) return;
  const form = document.getElementById('utility-form');
  const pane = root.querySelector('[data-utility-questions]');
  const result = root.querySelector('[data-utility-result]');
  const progress = root.querySelector('[data-utility-progress]');
  const validation = root.querySelector('[data-utility-validation]');
  const steps = [...root.querySelectorAll('[data-utility-step]')];
  const reached = new Set();
  const labels = {
    object: { home: 'Частный дом или участок', commercial: 'Крупный коммерческий объект', other: 'Другой объект' },
    location: { simferopol: 'Симферополь', outside: 'За пределами Симферополя' },
    connection: { known: 'Точка подключения известна', nearby: 'Сеть рядом, точку нужно уточнить', unknown: 'Точка подключения неизвестна' },
    documents: { ready: 'ТУ или проект есть', progress: 'Документы в оформлении', none: 'Документов пока нет', unknown: 'Документы: нужно уточнить' },
    length: { short: 'Трасса до 10 м', medium: 'Трасса 10–30 м', long: 'Трасса более 30 м', unknown: 'Длина трассы неизвестна' },
    surface: { soil: 'Грунт', paved: 'Плитка, асфальт или дорога', mixed: 'Разные покрытия', unknown: 'Покрытие: нужно посмотреть' }
  };
  let step = 0;
  let completed = false;
  let submittedFromResult = false;
  let invalidStep = null;
  const goal = (suffix, once = true, extra = {}) => {
    if (once && reached.has(suffix)) return;
    if (once) reached.add(suffix);
    try { window.KepstroyTracking?.trackGoal(service + '_' + suffix, { service: service === 'water' ? 'vodosnabzhenie' : 'kanalizaciya', widget_version: 'utility_selector_v1', ...extra }); } catch { /* analytics cannot block the action */ }
  };
  const value = name => root.querySelector(`input[name="${name}"]:checked`)?.value;
  const show = () => {
    steps.forEach((el, i) => { el.hidden = i !== step; });
    root.querySelector('[data-utility-back]').hidden = step === 0;
    root.querySelector('[data-utility-next]').textContent = step === 2 ? 'Показать результат' : 'Далее';
    progress.textContent = 'Шаг ' + (step + 1) + ' из 3';
    validation.hidden = true;
    progress.focus({ preventScroll: true });
    root.scrollIntoView({ block: 'start', behavior: 'instant' });
  };
  const start = () => {
    root.querySelector('[data-utility-start]').hidden = true;
    pane.hidden = false;
    result.hidden = true;
    show();
  };
  root.querySelector('[data-utility-start]').addEventListener('click', start);
  document.querySelectorAll('[data-utility-open]').forEach(el => el.addEventListener('click', () => { if (pane.hidden && !completed) start(); }));
  root.addEventListener('change', () => {
    goal('calc_start');
    invalidStep = null;
    validation.hidden = true;
    if (completed) {
      completed = false;
      form.elements.message.value = 'Запрос на подключение к центральной сети. Подбор редактируется.';
    }
  });
  root.querySelector('[data-utility-back]').addEventListener('click', () => { if (step > 0) { step--; show(); } });
  root.querySelector('[data-utility-edit]').addEventListener('click', () => { step = 0; completed = false; form.elements.message.value = 'Запрос на подключение к центральной сети. Подбор редактируется.'; start(); });
  root.querySelector('[data-utility-next]').addEventListener('click', () => {
    const fields = [...steps[step].querySelectorAll('fieldset')];
    const missing = fields.find(field => !field.querySelector('input:checked'));
    if (missing) {
      validation.hidden = false;
      missing.querySelector('input').focus();
      if (invalidStep !== step) goal('calc_validation_error', false, { step_id: String(step + 1), reason: 'missing_choice' });
      invalidStep = step;
      return;
    }
    if (step < 2) { goal('calc_step' + (step + 1)); step++; show(); return; }
    const summary = Object.keys(labels).map(name => labels[name][value(name)]).join('; ') + '.';
    const next = (value('location') === 'outside' ? 'До выезда подготовьте видео предполагаемой трассы и ближайшего колодца. ' : 'Для первого разговора подготовьте адрес объекта. ')
      + (value('object') === 'commercial' ? 'Для крупного коммерческого объекта можно отдельно обсудить внутреннюю разводку. ' : 'Работы ограничены наружными сетями, максимум вводом на участок. ')
      + 'Документацией занимается КэпСтрой, фактическую врезку выполняет водоканал.';
    root.querySelector('[data-utility-summary]').textContent = summary;
    root.querySelector('[data-utility-next-step]').textContent = next;
    form.elements.message.value = 'Подбор подключения: ' + summary;
    completed = true;
    pane.hidden = true;
    result.hidden = false;
    result.focus({ preventScroll: true });
    result.scrollIntoView({ block: 'center', behavior: 'instant' });
    goal('calc_result');
  });
  form.addEventListener('input', event => { if (event.target.name === 'phone') goal(completed ? 'calc_form_start' : 'form_start'); });
  root.querySelectorAll('[data-utility-route]').forEach(link => link.addEventListener('click', () => {
    try { window.KepstroyTracking?.trackGoal('utility_route', { from_service: service === 'water' ? 'vodosnabzhenie' : 'kanalizaciya', to_service: link.dataset.utilityRoute }); } catch { /* keep navigation available */ }
  }));
  form.addEventListener('kepstroy:form-result', event => {
    const { phase, diagnostic } = event.detail;
    const error = form.querySelector('[data-utility-error]');
    if (phase === 'attempt') {
      submittedFromResult = completed;
      error.hidden = true;
      goal(submittedFromResult ? 'calc_submit_attempt' : 'form_submit_attempt', false);
    } else if (phase === 'success') goal(submittedFromResult ? 'calc_success' : 'form_success', false);
    else if (phase === 'error') {
      event.preventDefault();
      goal(submittedFromResult ? 'calc_error' : 'form_error', false, { reason: diagnostic?.reason || 'unknown', http_status: diagnostic?.http_status || 0 });
      error.textContent = diagnostic?.reason === 'duplicate_submission'
        ? 'Такая заявка уже получена. Для уточнений позвоните: +7 (978) 461-59-62.'
        : 'Подтверждение отправки не получено. Заявка могла дойти. Позвоните: +7 (978) 461-59-62 или попробуйте ещё раз.';
      error.hidden = false;
    }
  });
  // A view requires half the component visible for one second in an active tab.
  let timer = null;
  let visible = false;
  const observeView = () => {
    clearTimeout(timer);
    if (visible && !document.hidden && !reached.has('calc_view')) timer = setTimeout(() => goal('calc_view'), 1000);
  };
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => { visible = entries[0].intersectionRatio >= .5; observeView(); }, { threshold: [.5] });
    observer.observe(root);
    document.addEventListener('visibilitychange', observeView);
  }
})();
