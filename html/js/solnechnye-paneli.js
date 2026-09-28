const SCENARIO_LABELS = {
  panels: 'Только панели',
  installation: 'Панели с монтажом',
  turnkey: 'Система под ключ',
};

const OBJECT_LABELS = {
  house: 'Частный дом',
  dacha: 'Дача',
  business: 'Коммерческий объект',
  remote: 'Объект без электросети',
  other: 'Другой объект',
};

const TASK_LABELS = {
  backup: 'Резерв при отключениях',
  saving: 'Снизить потребление из сети',
  autonomy: 'Обеспечить объект без электросети',
  panels: 'Купить солнечные панели',
  consult: 'Нужна консультация',
};

const CONSUMPTION_LABELS = {
  unknown: 'Нет данных',
  bill: 'Есть квитанция за электричество',
  meter: 'Есть показания счётчика',
  appliances: 'Могу перечислить основные приборы',
};

const PLACEMENT_LABELS = {
  consult: 'Нужна консультация',
  roof: 'Крыша',
  ground: 'Наземная конструкция',
};

const formatNumber = (value, maximumFractionDigits = 0) => (
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits })
    .format(value)
    .replace(/[\u00a0\u202f]/g, ' ')
);

const formatPanelsQuantity = (quantity) => {
  const remainder100 = quantity % 100;
  const remainder10 = quantity % 10;
  const noun = remainder10 === 1 && remainder100 !== 11
    ? 'панель'
    : remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)
      ? 'панели'
      : 'панелей';
  return `${quantity} ${noun}`;
};

const normalizeSolarCalculatorConfig = ({ panelPowerW, panelPriceRub } = {}) => {
  const normalized = {
    panelPowerW: Number(panelPowerW),
    panelPriceRub: Number(panelPriceRub),
  };
  if (
    !Number.isFinite(normalized.panelPowerW)
    || normalized.panelPowerW <= 0
    || !Number.isFinite(normalized.panelPriceRub)
    || normalized.panelPriceRub <= 0
  ) {
    throw new RangeError('Параметры солнечной панели должны быть положительными числами');
  }
  return normalized;
};

const readSolarCalculatorConfig = (root) => normalizeSolarCalculatorConfig({
  panelPowerW: root?.dataset?.panelPowerW,
  panelPriceRub: root?.dataset?.panelPriceRub,
});

const calculatePanels = (rawQuantity, config) => {
  const quantity = Number(rawQuantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    throw new RangeError('Количество панелей должно быть целым числом от 1 до 100');
  }
  const { panelPowerW, panelPriceRub } = normalizeSolarCalculatorConfig(config);
  return {
    quantity,
    panelPowerKw: panelPowerW / 1000,
    powerKw: Math.round(quantity * panelPowerW) / 1000,
    panelsPrice: quantity * panelPriceRub,
  };
};

const createSolarQualification = ({
  scenario = 'turnkey',
  objectType = 'other',
  primaryTask = 'consult',
  monthlyConsumption = 'unknown',
  placement = 'consult',
  panelQuantity = '',
} = {}, config) => {
  const normalizedScenario = SCENARIO_LABELS[scenario] ? scenario : 'turnkey';
  const trimmedQuantity = String(panelQuantity ?? '').trim();
  return {
    scenario: normalizedScenario,
    objectType: OBJECT_LABELS[objectType] ? objectType : 'other',
    primaryTask: TASK_LABELS[primaryTask] ? primaryTask : 'consult',
    monthlyConsumption: CONSUMPTION_LABELS[monthlyConsumption]
      ? monthlyConsumption
      : 'unknown',
    placement: PLACEMENT_LABELS[placement] ? placement : 'consult',
    panelCalculation: normalizedScenario === 'panels' && trimmedQuantity
      ? calculatePanels(trimmedQuantity, config)
      : null,
  };
};

const cleanText = (value, maxLength) => String(value || '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maxLength);

const resolveSolarPageCity = (requestForm) => cleanText(
  requestForm?.dataset?.solarCity,
  100,
);

const syncSolarCityField = (requestForm) => {
  const pageCity = resolveSolarPageCity(requestForm);
  const cityInput = requestForm?.elements?.namedItem?.('city');
  if (cityInput && 'value' in cityInput) cityInput.value = pageCity;
  return pageCity;
};

const buildLeadMessage = ({
  qualification,
  comment,
}) => {
  const safeQualification = qualification || createSolarQualification();
  const lines = [
    'Данные для подбора солнечной системы',
    `Что требуется: ${SCENARIO_LABELS[safeQualification.scenario] || SCENARIO_LABELS.turnkey}`,
    `Объект: ${OBJECT_LABELS[safeQualification.objectType] || OBJECT_LABELS.other}`,
    `Задача: ${TASK_LABELS[safeQualification.primaryTask] || TASK_LABELS.consult}`,
    `Потребление: ${CONSUMPTION_LABELS[safeQualification.monthlyConsumption] || CONSUMPTION_LABELS.unknown}`,
    `Размещение: ${PLACEMENT_LABELS[safeQualification.placement] || PLACEMENT_LABELS.consult}`,
  ];
  const calculation = safeQualification.panelCalculation;
  if (safeQualification.scenario === 'panels') {
    if (calculation) {
      lines.push(`Количество: ${formatPanelsQuantity(calculation.quantity)}`);
      lines.push(`Номинальная мощность панелей: ${formatNumber(calculation.panelPowerKw, 3)} × ${calculation.quantity} = ${formatNumber(calculation.powerKw, 3)} кВт`);
      lines.push(`Стоимость панелей: ${formatNumber(calculation.panelsPrice)} ₽`);
    } else {
      lines.push('Количество панелей: уточнить');
    }
  }
  const safeComment = cleanText(comment, 500);
  if (safeComment) lines.push(`Комментарий: ${safeComment}`);
  lines.push('Состав и стоимость системы уточняются после проверки исходных данных.');
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
    const calculatorConfigRoot = document.querySelector('.solar-page');
    if (!calculator || !requestForm || !calculatorConfigRoot) return;

    const scenarioInput = document.getElementById('order-scenario');
    const objectInput = document.getElementById('object-type');
    const taskInput = document.getElementById('primary-task');
    const consumptionInput = document.getElementById('monthly-consumption');
    const placementInput = document.getElementById('placement');
    const quantityField = document.getElementById('panel-quantity-field');
    const quantityInput = document.getElementById('panel-quantity');
    const commentInput = document.getElementById('solar-comment');
    const messageInput = document.getElementById('solar-message');
    const resultTitle = document.getElementById('solar-result-title');
    const resultSummary = document.getElementById('solar-result-summary');
    const resultNote = document.getElementById('solar-result-note');
    const error = document.getElementById('solar-calculator-error');
    const calculateButton = document.getElementById('solar-calculate');
    let calculatorConfig;
    try {
      calculatorConfig = readSolarCalculatorConfig(calculatorConfigRoot);
    } catch {
      error.textContent = 'Предварительный расчёт временно недоступен.';
      error.hidden = false;
      calculateButton.disabled = true;
      return;
    }
    let calculatorStarted = false;
    let calculatorResultTracked = false;
    let formStarted = false;

    const qualification = () => createSolarQualification({
      scenario: scenarioInput.value,
      objectType: objectInput.value,
      primaryTask: taskInput.value,
      monthlyConsumption: consumptionInput.value,
      placement: placementInput.value,
      panelQuantity: quantityInput.value,
    }, calculatorConfig);

    const syncMessage = (currentQualification = qualification()) => {
      syncSolarCityField(requestForm);
      messageInput.value = buildLeadMessage({
        qualification: currentQualification,
        comment: commentInput.value,
      });
    };

    const renderQualification = () => {
      const panelsOnly = scenarioInput.value === 'panels';
      quantityField.hidden = !panelsOnly;
      try {
        const currentQualification = qualification();
        quantityInput.removeAttribute('aria-invalid');
        error.hidden = true;
        const calculation = currentQualification.panelCalculation;
        resultTitle.textContent = calculation ? 'Расчёт панелей готов' : 'Данные для подбора готовы';
        if (calculation) {
          resultSummary.textContent = `${formatPanelsQuantity(calculation.quantity)} · ${formatNumber(calculation.powerKw, 3)} кВт · ${formatNumber(calculation.panelsPrice)} ₽ за панели`;
          resultNote.textContent = 'Доставку, монтаж и комплектующие рассчитаем отдельно.';
        } else if (panelsOnly) {
          resultSummary.textContent = 'Количество и наличие панелей уточним при звонке';
          resultNote.textContent = 'Можно продолжить без точного количества.';
        } else {
          const consumption = CONSUMPTION_LABELS[currentQualification.monthlyConsumption];
          resultSummary.textContent = `${TASK_LABELS[currentQualification.primaryTask]} · ${OBJECT_LABELS[currentQualification.objectType]} · ${consumption === CONSUMPTION_LABELS.unknown ? 'данные о потреблении уточним' : consumption}`;
          resultNote.textContent = 'Состав и стоимость системы уточним после проверки исходных данных.';
        }
        syncMessage(currentQualification);
        return true;
      } catch {
        quantityInput.setAttribute('aria-invalid', 'true');
        error.hidden = false;
        return false;
      }
    };

    const markCalculatorStarted = () => {
      if (calculatorStarted) return;
      calculatorStarted = true;
      trackSolarGoal('solar_calculator_start');
    };

    scenarioInput.addEventListener('change', () => {
      if (scenarioInput.value === 'panels') taskInput.value = 'panels';
      else if (taskInput.value === 'panels') taskInput.value = 'consult';
    });
    calculator.addEventListener('input', () => {
      markCalculatorStarted();
      renderQualification();
    });
    calculator.addEventListener('change', renderQualification);
    calculateButton.addEventListener('click', () => {
      markCalculatorStarted();
      if (renderQualification() && !calculatorResultTracked) {
        calculatorResultTracked = true;
        trackSolarGoal('solar_calculator_result');
      }
    });

    requestForm.addEventListener('focusin', () => {
      if (formStarted) return;
      formStarted = true;
      trackSolarGoal('solar_form_start');
    });
    requestForm.addEventListener('submit', () => syncMessage(), true);
    commentInput.addEventListener('input', () => syncMessage());
    renderQualification();
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculatePanels,
    createSolarQualification,
    buildLeadMessage,
    normalizeSolarCalculatorConfig,
    readSolarCalculatorConfig,
    resolveSolarPageCity,
    syncSolarCityField,
  };
}
