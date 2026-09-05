# Metrika Notice and Complete Footer Implementation Plan

> **For the agent:** REQUIRED SUB-SKILL: Use $executing-plans to implement this plan task-by-task.

**Goal:** Загружать Яндекс.Метрику сразу, показывать только информационное уведомление с кнопкой «Понятно» и перечислять все восемь опубликованных услуг в подвале каждой публичной страницы.

**Architecture:** Общий загрузчик `html/js/analytics-consent.js` сохраняет единственную точку инициализации счётчика и публичный API целей, но отделяет аналитику от состояния уведомления. Статические HTML-страницы и два генераторных шаблона получают унифицированный список ссылок, защищённый контрактным тестом; политика, валидатор и браузерный аудит проверяют ту же модель.

**Tech Stack:** статический HTML/CSS/JavaScript, Node.js `node:test`, Python `unittest`, Playwright, GitHub Actions.

---

### Task 1: Перевести runtime-контракт аналитики на информационную модель

**Files:**
- Modify: `tests/test_analytics_consent_runtime.cjs`
- Modify: `html/js/analytics-consent.js`

**Step 1: Write the failing tests**

Заменить ожидания opt-in на проверки, что до готовности DOM уже созданы очередь `ym`, тег Метрики и единственный вызов `init`; после `DOMContentLoaded` видны текст про анализ посещаемости и кнопка «Понятно». Добавить проверки нового ключа `kepstroy_metrika_notice_acknowledged`, миграции `kepstroy_analytics_consent=true`, работы `trackGoal`/`getClientID` до нажатия и независимости аналитики от ошибок `localStorage`.

**Step 2: Run test to verify it fails**

Run: `npm run test:analytics-consent`

Expected: FAIL, потому что текущий загрузчик остаётся в состоянии `idle` и не создаёт тег до согласия.

**Step 3: Write minimal implementation**

В `analytics-consent.js`:

- заменить `STORAGE_KEY` на `kepstroy_metrika_notice_acknowledged` и добавить только читаемую поддержку старого `kepstroy_analytics_consent`;
- вызывать `loadMetrika()` сразу после публикации API;
- удалить проверки согласия из `loadMetrika`, `trackGoal` и `getClientID`;
- заменить `hasConsent()` на `isNoticeAcknowledged()`;
- показывать текст «Мы используем Яндекс.Метрику для анализа посещаемости и улучшения работы сайта. » и кнопку «Понятно»;
- при клике скрывать уведомление независимо от результата записи в хранилище;
- переименовать внутренние обработчики и aria-label с семантики согласия на уведомление.

**Step 4: Run test to verify it passes**

Run: `npm run test:analytics-consent`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/test_analytics_consent_runtime.cjs html/js/analytics-consent.js
git commit -m "feat: load Metrika before notice acknowledgement"
```

### Task 2: Обновить статический контракт, политику и версию загрузчика

**Files:**
- Modify: `tests/test_analytics_consent.py`
- Modify: `html/politika-konfidencialnosti/index.html`
- Modify: `scripts/validate.py`
- Modify: `html/**/*.html`
- Modify: `generators/city-index-template.html`
- Modify: `generators/city-septik-template.html`

**Step 1: Write the failing tests**

Переименовать тесты и ожидания: политика описывает немедленное подключение Метрики и ключ отметки уведомления; все страницы подключают `/js/analytics-consent.js?v=2`; валидатор требует новый shared-loader contract и запрещает старую версию.

**Step 2: Run test to verify it fails**

Run: `python -m unittest tests.test_analytics_consent -v`

Expected: FAIL на старом тексте политики, ключе и `?v=1`.

**Step 3: Write minimal implementation**

Обновить разделы 6–7 политики, контракт валидатора и заменить ссылку загрузчика `?v=1` на `?v=2` во всех публичных HTML-файлах и шаблонах.

**Step 4: Run test to verify it passes**

Run: `python -m unittest tests.test_analytics_consent -v`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/test_analytics_consent.py scripts/validate.py html generators/city-index-template.html generators/city-septik-template.html
git commit -m "docs: align site with immediate Metrika loading"
```

### Task 3: Унифицировать список услуг в подвале

**Files:**
- Create: `tests/test_footer_services.py`
- Modify: `html/**/*.html`
- Modify: `generators/city-index-template.html`
- Modify: `generators/city-septik-template.html`

**Step 1: Write the failing test**

Тест должен найти подвал каждой публичной страницы и каждого шаблона, извлечь ссылки блока «Услуги» и потребовать ровно восемь уникальных целей:

```python
EXPECTED = {
    "/uslugi/septiki/",
    "/uslugi/kanalizaciya/",
    "/uslugi/zabory/",
    "/uslugi/vodosnabzhenie/",
    "/uslugi/gazosnabzhenie/",
    "/uslugi/elektrosnabzhenie/",
    "/uslugi/generatory/",
    "/uslugi/yuridicheskoe-soprovozhdenie-podklyuchenij/",
}
```

Дополнительно проверить существование `index.html` для каждой цели и отсутствие `septiki_dead`.

**Step 2: Run test to verify it fails**

Run: `python -m unittest tests.test_footer_services -v`

Expected: FAIL с перечнем страниц, где сейчас представлены три–семь услуг.

**Step 3: Write minimal implementation**

Механически заменить содержимое каждого блока услуг в подвале на согласованный набор из восьми ссылок с краткими подписями: «Септики», «Канализация», «Заборы», «Водоснабжение», «Газоснабжение», «Электроснабжение», «Резервные генераторы», «Юридическое сопровождение».

**Step 4: Run test to verify it passes**

Run: `python -m unittest tests.test_footer_services -v`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/test_footer_services.py html generators/city-index-template.html generators/city-septik-template.html
git commit -m "feat: list all services in site footers"
```

### Task 4: Обновить браузерный аудит и проверить весь сайт

**Files:**
- Modify: `scripts/audit-full-site-browser.cjs`
- Modify: `tests/test_accessibility_runtime.cjs` (только если фикстура использует старый ключ)
- Modify: `docs/operations/security-and-deploy-log.md` (если журнал требует фиксации преддеплойной проверки)

**Step 1: Write the failing browser assertion**

В `auditConsent` заменить проверку «до согласия нет Метрики» на проверку: новый ключ отсутствует, `ym` и один тег Метрики уже присутствуют, уведомление видно, кнопка называется «Понятно»; после клика уведомление скрыто и новый ключ равен `true`.

**Step 2: Run focused checks to verify mismatch**

Run: `npm run test:analytics-consent && python -m unittest tests.test_analytics_consent tests.test_footer_services -v`

Expected: PASS профильных тестов; старый браузерный аудит считается устаревшим до следующего шага.

**Step 3: Update audit and dependent fixtures**

Обновить браузерный аудит и accessibility-фикстуру на новый ключ, не скрывая реальные ошибки страницы.

**Step 4: Run full verification**

Run:

```bash
npm test
python scripts/validate.py
npm run build
```

Затем запустить локальный сайт и `npm run audit:browser` согласно существующему проектному сценарию.

Expected: все тесты, валидатор, сборка и браузерный аудит PASS; в консоли нет ошибок сайта, все ссылки услуг отвечают без 404.

**Step 5: Commit**

```bash
git add scripts/audit-full-site-browser.cjs tests/test_accessibility_runtime.cjs docs/operations/security-and-deploy-log.md
git commit -m "test: verify analytics notice and complete footers"
```

### Task 5: Финальная проверка готовности

**Files:**
- Review only: working tree and commit history

**Step 1: Invoke required skills**

Использовать `$production-readiness` и `$verification-before-completion`.

**Step 2: Inspect diff and repository state**

Run: `git status --short --branch` and `git diff HEAD~4 --check`.

Expected: чистое дерево, нет whitespace errors, изменения ограничены аналитическим уведомлением, политикой, подвалами и их проверками.

**Step 3: Re-run final evidence commands**

Run: `npm test`, `python scripts/validate.py`, `npm run build`.

Expected: exit code 0 for every command.

**Step 4: Prepare handoff**

Сообщить пользователю точное поведение, изменённые области и результаты проверок. Не выполнять push/deploy без отдельного явного запроса.
