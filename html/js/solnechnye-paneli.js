const SOLAR_PANEL_POWER_KW = 0.65;
const SOLAR_PANEL_PRICE = 20000;

const SCENARIO_LABELS = {
  panels: 'Только панели',
  installation: 'Панели с монтажом',
  turnkey: 'Система под ключ',
};

const SYSTEM_LABELS = {
  unknown: 'Нужна консультация',
  autonomous: 'Автономная',
  grid: 'Сетевая',
  hybrid: 'Гибридная',
};

const PLACEMENT_LABELS = {
  consult: 'Нужна консультация',
  roof: 'Крыша',
  ground: 'Наземная конструкция',
};

const SOLAR_CITY_BY_SLUG = Object.freeze({
  simferopol: 'Симферополь',
  sevastopol: 'Севастополь',
  jalta: 'Ялта',
  evpatorija: 'Евпатория',
  kerch: 'Керчь',
  feodosija: 'Феодосия',
  alushta: 'Алушта',
  sudak: 'Судак',
  dzhankoj: 'Джанкой',
  saki: 'Саки',
  bahchisaraj: 'Бахчисарай',
  armjansk: 'Армянск',
});

const formatNumber = (value, maximumFractionDigits = 0) => (
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits })
    .format(value)
    .replace(/[\u00a0\u202f]/g, ' ')
);

const calculatePanels = (rawQuantity) => {
  const quantity = Number(rawQuantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    throw new RangeError('Количество панелей должно быть целым числом от 1 до 100');
  }
  return {
    quantity,
    powerKw: Math.round(quantity * SOLAR_PANEL_POWER_KW * 100) / 100,
    panelsPrice: quantity * SOLAR_PANEL_PRICE,
  };
};

const cleanText = (value, maxLength) => String(value || '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maxLength);

const resolveSolarCity = (pathname) => {
  const match = String(pathname || '').match(
    /^\/krym\/([a-z0-9-]+)\/solnechnye-paneli\/(?:index\.html)?$/,
  );
  return match ? (SOLAR_CITY_BY_SLUG[match[1]] || '') : '';
};

const buildLeadMessage = ({
  calculation,
  scenario,
  systemType,
  placement,
  locality,
  city,
  comment,
}) => {
  const lines = [
    'Предварительный расчёт солнечной системы',
    `Сценарий: ${SCENARIO_LABELS[scenario] || SCENARIO_LABELS.turnkey}`,
    `Количество: ${calculation.quantity} панелей`,
    `Номинальная мощность панелей: 0,65 × ${calculation.quantity} = ${formatNumber(calculation.powerKw, 2)} кВт`,
    `Стоимость панелей: ${formatNumber(calculation.panelsPrice)} ₽`,
    `Тип системы: ${SYSTEM_LABELS[systemType] || SYSTEM_LABELS.unknown}`,
    `Размещение: ${PLACEMENT_LABELS[placement] || PLACEMENT_LABELS.consult}`,
  ];
  const safeCity = cleanText(city, 100);
  const safeLocality = cleanText(locality, 100);
  const safeComment = cleanText(comment, 500);
  if (safeCity) lines.push(`Город страницы: ${safeCity}`);
  if (safeLocality && safeLocality !== safeCity) {
    lines.push(`Населённый пункт: ${safeLocality}`);
  }
  if (safeComment) lines.push(`Комментарий: ${safeComment}`);
  lines.push('Монтаж, доставка и комплектующие рассчитываются отдельно.');
  return lines.join('\n').slice(0, 1000);
};

const trackSolarGoal = (goal) => {
  try {
    if (window.KepstroyTracking) window.KepstroyTracking.trackGoal(goal);
  } catch {
    // Analytics must never block the calculator or form.
  }
};

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.querySelector('.menu-toggle');
    const menu = document.getElementById('solar-menu');
    if (toggle && menu) {
      const syncMenu = () => {
        const open = menu.classList.contains('active');
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
        menu.inert = !open;
      };

      new MutationObserver(syncMenu).observe(menu, {
        attributes: true,
        attributeFilter: ['class'],
      });
      syncMenu();

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Tab' && menu.classList.contains('active')) {
          const items = [toggle, ...menu.querySelectorAll('a[href]')];
          const index = items.indexOf(document.activeElement);
          const wrapBack = event.shiftKey && index === 0;
          const wrapForward = !event.shiftKey && index === items.length - 1;
          if (index === -1 || wrapBack || wrapForward) {
            event.preventDefault();
            items[event.shiftKey ? items.length - 1 : 0].focus();
          }
        }
        if (event.key === 'Escape' && menu.classList.contains('active')) {
          toggle.click();
          toggle.focus();
        }
      });

      window.matchMedia('(min-width: 1024px)').addEventListener('change', (event) => {
        if (event.matches && menu.classList.contains('active')) toggle.click();
      });

      // Run in capture phase so focus and reduced-motion behaviour take precedence
      // over the shared smooth-scroll listener from main.js.
      document.addEventListener('click', (event) => {
        const anchor = event.target.closest('a[href^="#"]');
        if (!anchor) return;
        const target = document.getElementById(anchor.hash.slice(1));
        if (!target) return;

        if (anchor.classList.contains('solar-skip') || menu.contains(anchor)) {
          if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
          target.focus({ preventScroll: true });
        }

        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (menu.classList.contains('active')) toggle.click();
        target.scrollIntoView({ behavior: 'instant', block: 'start' });
      }, true);
    }

    const calculator = document.getElementById('solar-calculator');
    const requestForm = document.getElementById('solar-request-form');
    if (!calculator || !requestForm) return;

    const quantityInput = document.getElementById('panel-quantity');
    const scenarioInput = document.getElementById('order-scenario');
    const systemInput = document.getElementById('system-type');
    const placementInput = document.getElementById('placement');
    const localityInput = document.getElementById('solar-locality');
    const cityInput = requestForm.elements.namedItem('city');
    const commentInput = document.getElementById('solar-comment');
    const messageInput = document.getElementById('solar-message');
    const resultQuantity = document.getElementById('solar-result-quantity');
    const resultPower = document.getElementById('solar-result-power');
    const resultPrice = document.getElementById('solar-result-price');
    const error = document.getElementById('solar-calculator-error');
    const calculateButton = document.getElementById('solar-calculate');
    let calculatorStarted = false;
    let formStarted = false;
    let currentCalculation = calculatePanels(quantityInput.value);
    const pageCity = resolveSolarCity(window.location.pathname);

    const qualification = () => ({
      calculation: currentCalculation,
      scenario: scenarioInput.value,
      systemType: systemInput.value,
      placement: placementInput.value,
      locality: localityInput.value,
      city: pageCity,
      comment: commentInput.value,
    });

    const syncMessage = () => {
      if (cityInput && 'value' in cityInput) cityInput.value = pageCity;
      messageInput.value = buildLeadMessage(qualification());
    };

    const renderCalculation = () => {
      try {
        currentCalculation = calculatePanels(quantityInput.value);
        quantityInput.removeAttribute('aria-invalid');
        error.hidden = true;
        resultQuantity.textContent = `${currentCalculation.quantity} панелей`;
        resultPower.textContent = `${formatNumber(currentCalculation.powerKw, 2)} кВт`;
        resultPrice.textContent = `Стоимость панелей: ${formatNumber(currentCalculation.panelsPrice)} ₽`;
        syncMessage();
        return true;
      } catch {
        quantityInput.setAttribute('aria-invalid', 'true');
        error.hidden = false;
        return false;
      }
    };

    calculator.addEventListener('input', () => {
      if (!calculatorStarted) {
        calculatorStarted = true;
        trackSolarGoal('solar_calculator_start');
      }
      renderCalculation();
    });
    calculator.addEventListener('change', renderCalculation);
    calculateButton.addEventListener('click', () => {
      if (renderCalculation()) trackSolarGoal('solar_calculator_result');
    });

    requestForm.addEventListener('focusin', () => {
      if (formStarted) return;
      formStarted = true;
      trackSolarGoal('solar_form_start');
    });
    requestForm.addEventListener('submit', syncMessage, true);
    commentInput.addEventListener('input', syncMessage);
    syncMessage();
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SOLAR_PANEL_POWER_KW,
    SOLAR_PANEL_PRICE,
    calculatePanels,
    buildLeadMessage,
    resolveSolarCity,
  };
}
