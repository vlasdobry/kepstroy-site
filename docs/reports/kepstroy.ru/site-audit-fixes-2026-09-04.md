# Проверка исправлений полного аудита kepstroy.ru

**Дата проверки:** 2026-09-05

**Ветка:** `feature/generators-page`

**Статус:** локальная проверка пройдена; изменения не объединены с `main` и не развёрнуты в production. Полный security-аудит не подтверждён, потому что Deep Security Scan не стартовал.

## Scope и ограничения

Проверен активный источник Docker-сборки `html/`, обработчик форм `form-handler/`, оба генератора городских страниц, deploy workflow, Docker Compose и тестовые контракты. Legacy-копии `site/` и `site-ot-ai-google/` не менялись. Production не открывался, деплой не запускался, реальные POST-заявки и внешние сообщения не отправлялись.

Chromium обслуживал сайт из локального HTTP-сервера. Внешние HTTP(S)-запросы перехватывались и завершались локальной пустой заглушкой. Обычный обход блокировал POST; единственная отправка калькулятора была отдельно перехвачена внутри браузера и не достигла локального сервера или production.

## Итог свежей верификации

| Слой | Результат 2026-09-05 |
|---|---|
| Python | `python -m unittest discover -s tests -p "test_*.py" -v`: 106 tests run, 103 passed, 3 skipped, 0 failures. Skips: реальный POSIX mode и 2 symlink-варианта недоступны на Windows; эквивалентные проверки через monkeypatch/валидацию пройдены. |
| Frontend form runtime | 8/8 passed, `CI=true`, без сети. |
| Analytics consent runtime | 11/11 passed, `CI=true`, без сети. |
| Accessibility runtime | 11/11 passed, `CI=true`; Chromium запускался локально. Дополнительно перебраны 2 880 комбинаций калькулятора. |
| Form handler | 12/12 passed; `npm audit --omit=dev` и полный `npm audit --json`: 0 уязвимостей в 80 production dependencies. |
| Root dependencies | `npm ci`, `npm audit --omit=dev` и полный `npm audit`: 0 уязвимостей. В корне только Playwright как dev dependency. |
| Pre-deploy validator | `python scripts/validate.py`: `All pre-deploy checks passed.` |
| Генераторы | 12/12 city index и 12/12 city septic страниц актуальны в `--check`; запись не выполнялась. |
| Static crawler | PASS: 55 HTML без Yandex verification; 52 indexable, 2 noindex, 1 error page; 2 619 references, 49 fragments, 123 images, 124 JSON-LD; 52 canonical точно совпадают с 52 sitemap URLs; robots.txt содержит 10 групп User-agent. |
| Chromium all-pages | PASS: 54 обычные страницы + 404 = 55 страниц × 4 ширины (360/768/900/1280) = 220 page-width runs; navigation/load, pageerror, console errors, локальные resource failures и document overflow — 0 итоговых ошибок. |
| Chromium journeys | PASS: consent до разрешения не создаёт `ym`/тег/запрос Метрики; модалка главной открывается; городская CTA достигает `#callback`; телефонная CTA имеет корректный `tel:`; калькулятор отправляет ровно 1 перехваченный POST с `septic_type`, `region`, `distance`, `people`, `price`. |
| JS/YAML/Compose | `node --check` — 7 site/backend runtime JS и browser runner; YAML parse — workflow и compose; `KEPSTROY_IMAGE_TAG=test-sha docker compose config --quiet` — exit 0. |
| Git hygiene | `git diff --check` — без ошибок; секретоподобные файлы в diff не найдены; diff legacy-каталогов пуст. |

Предупреждения среды: локальный Compose ожидаемо сообщил об отсутствующих `BOT_TOKEN`/`CHAT_ID`; значения не нужны для `config --quiet` и не подставлялись. Первая sandbox-попытка browser-тестов и одна параллельная sandbox-попытка `npm test` form-handler получили `spawn EPERM`; отдельные разрешённые локальные перезапуски прошли соответственно 11/11 и 12/12. `npm ci` form-handler при установке один раз напечатал 3 moderate, однако немедленные production и полные `npm audit` после установки показали 0; незакрытых advisory в установленном дереве нет. `git status` предупреждает о недоступном служебном каталоге `pytest-cache-files-uchxfixv/`, который не входит в diff и не изменялся этой задачей.

## Матрица «аудит → исправление → проверка → owner»

| Исходный риск аудита | Исправление и коммиты | Свежая проверка | Оставшийся owner/действие |
|---|---|---|---|
| Новая услуга не имела отдельной конверсионной страницы и связной перелинковки | Страница генераторов, изображения, hub-links, sitemap и договорённости контента: `78c8965` | `test_generators_page`, static crawler, 220 browser runs | Андрей: подтвердить будущие модели, комплектации, наличие и цены до публикации новых обещаний. |
| Калькулятор и общий JS могли дублировать заявку; цель дублировалась на thank-you | Единый владелец submit, ранняя блокировка и guard, цель после `response.ok`: `de5f52d`, `dbf9060`, `4a58416`, `ce6af55` | Python contracts; form runtime 8/8; browser: ровно 1 перехваченный POST | После deploy — владелец аналитики проверяет одну тестовую заявку по согласованной безопасной процедуре. |
| Квалификационные поля калькулятора терялись; пользовательский HTML требовал безопасного round-trip | Поля лида и безопасные статусы Telegram: `0c7e795`, `c92facf`, `71e830d` | Backend 12/12; browser подтвердил все 5 полей | Андрей: подтвердить, достаточно ли набора полей для продажи; это не блокирует техническую доставку. |
| CTA вызывали отсутствующую модалку или несуществующий target | Главная открывает существующую модалку, городские CTA ведут к `#callback`/телефону: `a11668b`, `5233dc3` | Contracts + 3 browser CTA journeys | После deploy — ручной smoke владельцем сайта на реальном домене. |
| Противоречивые цены, сроки, скидка, «без откачки», псевдолокальные кейсы/отзывы и география офисов | Неподтверждённые утверждения удалены, цены ограничены подтверждённым составом, городские тексты нейтрализованы: `937b811`, `92f2f9a`, `a63bdc3`, `d8119a6`, `c860112`, `8fd6027`, `1bed860` | Content/SEO/GEO contracts входят в 106 Python tests; crawler: 52 canonical/sitemap; browser: 55 страниц | Андрей: закрыть реестр фактов; до этого удалённые claims не возвращать. |
| Gap навигации 769–1023 px, page-wide overflow таблиц, слабая клавиатурная/ARIA поддержка | Responsive navigation, FAQ, labels, dialog/menu semantics и runtime coverage: `cdbca68`, `522e6b7`, `7d7fc21`, `fbddfa3` | Accessibility 11/11; 220 browser runs на 360/768/900/1280 без overflow | Ручная проверка assistive technology после deploy желательна, но не заменяет уже пройденные контракты. |
| Метрика могла загружаться до явного согласия или дублироваться | Общий consent-gated loader с безопасным retry/dedupe: `3c3ec40`, `4760b2a`, `8b376ff` | Consent 11/11; browser до согласия: 0 `ym`, 0 тегов и 0 запросов Метрики | Владелец privacy/аналитики: проверить текст политики при изменении состава cookies. |
| Генераторы могли молча перезаписать страницы, выйти за output-root, зависеть от CRLF или оставить неверные права | Check-by-default, явный `--write`, LF contract, slug/containment/obsolete-output/mode/UTF-8 safety: `9e39785`, `300110a`, `85954e7` | Safety tests в Python suite; оба `--check` дают 12/12 | POSIX symlink/mode тесты дополнительно исполнятся в Linux CI; локально они пропущены по платформе. |
| Deploy смешивал ревизии, использовал mutable tag, мог пересекаться и создавал реальный тестовый лид | SHA images, подготовленные файлы той же ревизии, сериализация/stale guard, read-only health/page/Telegram smoke, pinned SSH actions: `75b8b61`, `1f8a65b` | 9 deploy contracts; YAML parse; Compose config с `test-sha` | Пользователь решает merge/deploy. Автоматический rollback остаётся отдельным архитектурным этапом. |
| Требовалась проверка уязвимостей всего проекта | Dependency audits, backend/runtime contracts, проверка отсутствия secret-like файлов выполнены | npm audits: 0; form/backend 12/12; deploy contracts 9/9 | **Security owner:** повторно запустить Deep Security Scan после выдачи разрешения/TAC. Текущие проверки не равны полному security-аудиту. |

## Conversion, SEO/GEO, доступность, security и deploy

- **Conversion:** форма имеет одного владельца отправки; калькулятор передаёт квалификацию; ключевые CTA достигают формы/модалки/телефона. В браузерной проверке не отправлялись реальные лиды.
- **SEO/GEO:** 52 индексируемые canonical соответствуют sitemap один-к-одному; локальные ссылки, фрагменты, изображения и structured data разрешаются. Страницы сохраняют работу по всему Крыму и не изображают отдельные офисы/кейсы без доказательств.
- **Доступность:** проверены меню, модалки, FAQ, labels, таблицы и четыре целевых ширины. Это автоматизированная базовая проверка, не формальная сертификация WCAG.
- **Privacy/security:** Метрика закрыта явным согласием; production dependency audits чисты; HTML-экранирование лида покрыто тестами. Deep Security Scan не стартовал из-за недоступного разрешения/TAC, поэтому полный security-статус остаётся открытым.
- **Deploy:** workflow проверен только статически. Production-deploy, merge и rollback не выполнялись. Автоматический rollback намеренно остаётся отдельным решением после стабилизации атомарного deploy.

## Факты, ожидающие Андрея

Единый реестр: [andrey-confirmations-required.md](andrey-confirmations-required.md).

До документального подтверждения нельзя возвращать в публичный контент:

- один из годов основания (2015/2016), «200+ объектов», общую гарантию, схемы оплаты и единый срок монтажа;
- локальные кейсы/отзывы, цены и сроки кейсов, привязку фотографий и взаимодействие с СЭС;
- бурение скважин, тарифы/состав центральной канализации и прокладки труб, модели насосов;
- цены и комплектацию заборов, тарифы и границы работ по электроснабжению;
- новые модели/цены/наличие генераторов либо солнечные электростанции без нового подтверждённого материала.

## Воспроизведение

```powershell
python -m unittest discover -s tests -p "test_*.py" -v
$env:CI='true'; node --test --test-isolation=none tests/test_form_runtime.cjs
$env:CI='true'; node --test --test-isolation=none tests/test_analytics_consent_runtime.cjs
$env:CI='true'; node --test --test-isolation=none tests/test_accessibility_runtime.cjs
npm ci
npm audit --omit=dev
Push-Location form-handler; npm ci; npm test; npm audit --omit=dev; Pop-Location
python scripts/validate.py
python scripts/audit-static-site.py
python generators/generate-city-indexes.py --check
python generators/generate-city-septik.py --check
$env:KEPSTROY_IMAGE_TAG='test-sha'; docker compose config --quiet
node scripts/audit-full-site-browser.cjs
git diff --check
git status --short
```

Следующий gate: независимый code review этой ветки, затем отдельное решение пользователя о merge и production-deploy.
