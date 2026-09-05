# Site Audit Fixes Implementation Plan

> **For the agent:** REQUIRED SUB-SKILL: Use $executing-plans to implement this plan task-by-task.

**Goal:** Выпустить новую страницу генераторов вместе с проверенным набором исправлений воронки, доверия, адаптивности, генераторов и CI/CD без неподтверждённых коммерческих обещаний.

**Architecture:** Общий `html/js/main.js` становится единственным владельцем отправки `/submit`; специфические страницы только заполняют поля формы. Шаблоны и сгенерированные страницы меняются синхронно, а тесты проверяют их договорённости. Деплой использует один SHA для checkout, образов и compose и не создаёт настоящих лидов.

**Tech Stack:** Статический HTML/CSS/JavaScript, Node.js form-handler и `node:test`, Python `unittest`, Playwright/Chromium для изолированных journey-тестов, Docker Compose, GitHub Actions.

## Фактический статус на 2026-09-05

| Задача | Статус |
|---|---|
| Task 1 | Реализована и локально проверена: единый submit, guard, цель только после успешного ответа. |
| Task 2 | Реализована и локально проверена: квалификация калькулятора сохраняется и HTML-экранируется. |
| Task 3 | Реализована и локально проверена: CTA главной и городских страниц достигают существующих действий. |
| Task 4 | Реализована и локально проверена: неподтверждённые обещания удалены, открытые факты вынесены в реестр Андрея. |
| Task 5 | Реализована и локально проверена на заявленных breakpoint и клавиатурных сценариях. |
| Task 6 | Реализована и локально проверена: оба генератора проходят `--check`, safety-тесты включены. |
| Task 7 | Реализована и локально проверена контрактами/YAML/Compose; production-deploy не запускался. |
| Task 8 | Локальная проверка и отчёт выполнены; все замечания независимых spec/quality/security/full-branch reviews исправлены, повторные reviews — PASS; merge и deploy не выполнялись. |

Статус ветки не означает готовность production без оговорок: Deep Security Scan не стартовал из-за недоступного разрешения/TAC; автоматический rollback и сам deploy остаются отдельными решениями.

---

### Task 1: Зафиксировать регрессии форм и целей

**Files:**
- Create: `tests/test_frontend_contracts.py`
- Modify: `html/js/main.js`
- Modify: `html/uslugi/septiki/index.html`
- Modify: `html/spasibo/index.html`

1. Добавить тесты, которые требуют: один владелец submit для `#calc-form`; блокировка до `appendTrackingData`; защита `form.dataset.submitting`; отсутствие `form_submit` на странице благодарности.
2. Запустить `python -m unittest tests.test_frontend_contracts -v` и увидеть ожидаемые FAIL на текущих дефектах.
3. Удалить inline-submit калькулятора. В общем обработчике выставлять guard и блокировать кнопку до ожидания атрибуции; при ошибке сбрасывать guard/кнопку.
4. Удалить безусловную цель со страницы `/spasibo/`; оставить цель только после `response.ok`.
5. Запустить новый тест и весь Python suite до PASS.

### Task 2: Сохранить квалификацию лида калькулятора

**Files:**
- Modify: `form-handler/test/lead-message.test.js`
- Modify: `form-handler/lead-message.js`

1. Добавить отдельный падающий тест на `septic_type`, `region`, `distance`, `people`, `price` с HTML-экранированием.
2. Запустить `node --test --test-isolation=none form-handler/test/*.test.js`; убедиться, что новый тест падает из-за отсутствующих строк.
3. Через `appendIfPresent` добавить понятные подписи всех пяти полей после услуги и до атрибуции.
4. Повторить Node suite до PASS.

### Task 3: Восстановить ключевые CTA

**Files:**
- Modify: `tests/test_frontend_contracts.py`
- Modify: `html/index.html`
- Modify: `generators/city-septik-template.html`
- Modify: `html/krym/*/septik-pod-kluch/index.html` (12 файлов)

1. Добавить падающие проверки: на главной callback вызывает существующую модалку; городские CTA не содержат `onclick="openModal()"`, если модалки нет, и ведут к существующему `#callback`/телефону.
2. На главной заменить мёртвый `href="#callback"` на кнопку/ссылку, открывающую `modalOverlay`.
3. В шаблоне и 12 страницах заменить две неработающие кнопки городов на ссылки к существующей секции `#callback` или `tel:` с соответствующим текстом.
4. Запустить contract-тест и статический crawler, убедиться в отсутствии битых якорей.

### Task 4: Исправить подтверждённые противоречия оффера

**Files:**
- Modify: `tests/test_content_consistency.py`
- Modify: `html/uslugi/septiki/index.html`
- Modify: `html/uslugi/kanalizaciya/index.html`
- Modify: `html/tseny/index.html`
- Modify: `html/llms.txt`
- Modify: `html/llms-full.txt`
- Modify: `generators/city-septik-template.html`
- Modify: `html/krym/*/septik-pod-kluch/index.html`

1. Добавить падающие проверки на отсутствие неподтверждённой онлайн-скидки, «без откачки», бесплатного замера и обещания выезда в день обращения; на единый подтверждённый email/набор услуг в llms; на отсутствие одной фотографии как доказательства 12 разных объектов.
2. Калькулятор отображает «предварительный расчёт», считает без скидки, кнопка просит получить расчёт, а сроки связи не обещает.
3. Синхронизировать JSON-LD: бесплатна консультация, выезд инженера 3 000–6 000 ₽ с возвратом при договоре.
4. Для автономной канализации убрать общий диапазон 80 000–150 000 ₽ без состава: сослаться на конкретные варианты септиков от 140 000 ₽; отдельное подключение к центральной сети оставить отдельной услугой.
5. В llms убрать устаревший email и абсолютные сроки/оплату/обслуживание, перечислить актуальные направления, включая генераторы candidate.
6. В шаблоне и городских страницах убрать same-day/«чаще всего», псевдолокальную атрибуцию общих фото, неподтверждённые блоки отзывов/кейсов; заменить на честный общий портфель работ по Крыму и CTA консультации.
7. Не выбирать между 2015/2016 и не подтверждать спорные бурение/СЭС/электротариф без Андрея; вынести их в follow-up реестр.
8. Запустить content consistency suite до PASS.

### Task 5: Адаптивность и базовая доступность

**Files:**
- Modify: `tests/test_frontend_contracts.py`
- Modify: `html/css/style.css`
- Modify: `html/css/blog.css`
- Modify: `html/js/main.js`
- Modify: `html/js/blog-accordion.js`
- Modify: затронутые HTML с FAQ/формами

1. Добавить contract-тесты на отсутствие gap 769–1023, keyboard semantics FAQ, `aria-expanded` меню и программные label основных форм.
2. Исправить breakpoint: hamburger остаётся доступным до появления desktop-nav.
3. Ограничить таблицы контейнером с `overflow-x:auto`/`max-width:100%`, не скрывая содержимое и не создавая page-wide overflow.
4. Сделать FAQ-кнопки клавиатурными с `aria-expanded`, управление меню через единую `setMenuOpen`, добавить Escape и возврат фокуса.
5. Связать видимые label с ключевыми input/select/range; модалкам добавить `role="dialog"`, `aria-modal`, заголовок и начальный фокус.
6. Запустить contract suite и изолированный Chromium smoke на 360/768/900/1280.

### Task 6: Не допускать возврата дефектов генераторами

**Files:**
- Modify: `tests/test_site_readiness.py`
- Modify: `generators/generate-city-indexes.py`
- Modify: `generators/generate-city-septik.py`
- Modify: соответствующие templates/data

1. Добавить падающий dry-run/check тест: генератор должен сообщать дрейф и не писать без явного `--write`; результат генерации во временной папке обязан проходить contract/content tests.
2. Реализовать CLI `--check` по умолчанию и `--write` для явной записи; атомарно заменять файл только при изменении.
3. Синхронизировать шаблоны с утверждёнными страницами и устранить все 24 расхождения.
4. Запустить генераторы в `--check`, readiness tests и crawler.

### Task 7: Сделать деплой ревизионно целостным

**Files:**
- Create/Modify: `tests/test_deploy_contract.py`
- Modify: `.github/workflows/deploy.yml`
- Modify: `docker-compose.yml`

1. Добавить падающие проверки на `concurrency`, SHA-tag images, отсутствие POST реальной заявки и отсутствие clone плавающего `main` на сервере.
2. Добавить workflow concurrency с отменой устаревшего запуска до deploy.
3. Тегировать site/form-handler `${{ github.sha }}` и передавать единый tag в compose; сервер получает подготовленные compose/nginx файлы той же ревизии, а не клонирует текущий main.
4. Заменить production POST-лид на внутренний `/health` и read-only HTTP smoke страниц.
5. Выполнить синтаксические contract-тесты и `docker compose config --quiet`; деплой не запускать.

### Task 8: Финальная верификация и отчёт

**Files:**
- Create: `docs/reports/kepstroy.ru/site-audit-fixes-2026-09-04.md`
- Modify: `docs/plans/2026-09-04-site-audit-fixes-implementation.md` (только фактические статусы)

1. Выполнить полные Python и Node suites, `scripts/validate.py`, оба генератора `--check`, crawler и `docker compose config --quiet`.
2. Запустить локальный Chromium-аудит 54/55 страниц на 360/768/900/1280 с блокировкой внешней сети и POST; отдельно воспроизвести один submit калькулятора и один вызов каждого CTA.
3. Проверить `git diff --check`, `git status`, итоговый diff и отсутствие изменений legacy/секретов.
4. Сохранить матрицу «аудит → исправление → проверка → оставшийся owner»; отдельно перечислить факты, ожидающие Андрея, и провал Deep Security Scan, не выдавая non-security проверки за security-аудит.
5. Запросить code review, обработать замечания, повторить полный verification и только затем предложить merge/deploy отдельным решением пользователя.
