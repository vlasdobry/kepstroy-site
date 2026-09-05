# Проверка исправлений полного аудита kepstroy.ru

**Дата проверки:** 2026-09-05

**Ветка:** `feature/generators-page`

**Статус:** локальная проверка пройдена; изменения не объединены с `main` и не развёрнуты в production. Полный security-аудит не подтверждён, потому что Deep Security Scan не стартовал.

## Scope и ограничения

Проверен активный источник Docker-сборки `html/`, обработчик форм `form-handler/`, оба генератора городских страниц, deploy workflow, Docker Compose и тестовые контракты. Legacy-копии `site/` и `site-ot-ai-google/` не менялись. Production не открывался, деплой не запускался, реальные POST-заявки и внешние сообщения не отправлялись.

Chromium обслуживал сайт из локального HTTP-сервера. Для каждого BrowserContext до создания страниц устанавливались HTTP- и WebSocket-guards, service workers блокировались, а внешний egress дополнительно направлялся в недоступный loopback proxy с bypass только для `127.0.0.1`. Внешние HTTP(S)-запросы перехватывались и завершались локальной пустой заглушкой; canonical host aliases `kepstroy.ru`/`www.kepstroy.ru` проверялись через тот же локальный route. Любой неожиданный POST независимо от origin блокировался с ошибкой; единственная ожидаемая отправка калькулятора была отдельно перехвачена внутри страницы и не достигла локального сервера или production.

## Итог свежей верификации

| Слой | Результат 2026-09-05 |
|---|---|
| Python | `python -m unittest discover -s tests -p "test_*.py" -v`: 113 tests run, 110 passed, 3 skipped, 0 failures. Skips: реальный POSIX mode и 2 generator symlink-варианта недоступны на Windows; эквивалентные проверки через monkeypatch/валидацию пройдены. |
| Audit tool safety | 7/7 Python static-crawler/report safety tests и 6/6 Node browser-safety tests; реальные fixture-crawls проверяют canonical aliases/ports, form endpoint scope, social/structured URLs и точный Docker image fallback, а browser resolver отклоняет realpath/junction escapes. |
| Frontend form runtime | 11/11 passed, `CI=true`, без сети. |
| Analytics consent runtime | 11/11 passed, `CI=true`, без сети. |
| Accessibility runtime | 11/11 passed, `CI=true`; Chromium запускался локально. Дополнительно перебраны 2 880 комбинаций калькулятора. |
| Form handler | 14/14 passed; `npm ls express body-parser qs --all` подтверждает Express 4.22.2 с overrides `body-parser` 1.20.6 и `qs` 6.16.0; `npm audit --omit=dev --json` и полный `npm audit`: 0 уязвимостей в 80 production dependencies. |
| Root dependencies | `npm ci`, `npm audit --omit=dev` и полный `npm audit`: 0 уязвимостей. В корне только Playwright как dev dependency. |
| Pre-deploy validator | `python scripts/validate.py`: `All pre-deploy checks passed.` |
| Генераторы | 12/12 city index и 12/12 city septic страниц актуальны в `--check`; запись не выполнялась. |
| Static crawler | PASS: 55 HTML без Yandex verification; 52 indexable, 2 noindex, 1 error page; 2 774 references, включая 128 URL-bearing значений из JSON-LD и 27 social-image meta, 49 DOM fragments, 123 `<img>` и 124 JSON-LD blocks; 52 canonical точно совпадают с 52 sitemap URLs; robots.txt содержит 10 групп User-agent. |
| Chromium all-pages | PASS: 54 обычные страницы + 404 = 55 страниц × 4 ширины (360/768/900/1280) = 220 page-width runs. После load каждая страница прокручена до конца для lazy-контента, выдержан settle 150 мс, затем проверены navigation, pageerror, console errors, локальные resource failures и document overflow; итоговых ошибок нет. 225 внешних HTTP(S)-попыток перехвачены, WebSocket-попыток — 0. |
| Chromium journeys | PASS: consent до разрешения не создаёт `ym`/тег/запрос Метрики; модалка главной открывается; городская CTA достигает `#callback`; телефонная CTA имеет корректный `tel:`; калькулятор отправляет ровно 1 перехваченный POST с `septic_type`, `region`, `distance`, `people`, `price`. |
| JS/YAML/Compose | `node --check` — 7 site/backend runtime JS и 2 browser-audit scripts; YAML parse — workflow и compose; `KEPSTROY_IMAGE_TAG=test-sha docker compose config --quiet` — exit 0. |
| Git hygiene | `git diff --check main...HEAD` — без ошибок; секретоподобные файлы в diff не найдены; diff legacy-каталогов пуст. |

Предупреждения среды: локальный Compose ожидаемо сообщил об отсутствующих `BOT_TOKEN`/`CHAT_ID`; значения не нужны для `config --quiet` и не подставлялись. Первая sandbox-попытка browser-тестов и одна параллельная sandbox-попытка `npm test` form-handler получили `spawn EPERM`; отдельные разрешённые локальные перезапуски прошли соответственно 11/11 и 14/14. Свежий `npm audit` до dependency fix обнаружил 3 moderate в parser-цепочке Express 4.22.2 (`body-parser`/`qs`); после точечных overrides, clean lock regeneration и `npm ci` оба audit-режима показывают 0. `git status` предупреждает о недоступном служебном каталоге `pytest-cache-files-uchxfixv/`, который не входит в diff и не изменялся этой задачей.

## Матрица «аудит → исправление → проверка → owner»

| Исходный риск аудита | Исправление и коммиты | Свежая проверка | Оставшийся owner/действие |
|---|---|---|---|
| Новая услуга не имела отдельной конверсионной страницы и связной перелинковки | Страница генераторов, изображения, hub-links, sitemap и договорённости контента: `78c8965` | `test_generators_page`, static crawler, 220 browser runs | Андрей: подтвердить будущие модели, комплектации, наличие и цены до публикации новых обещаний. |
| Калькулятор и общий JS могли дублировать заявку; цель дублировалась на thank-you | Единый владелец submit, ранняя блокировка и guard, цель после `response.ok`: `de5f52d`, `dbf9060`, `4a58416`, `ce6af55`, `284510d` | Python contracts; form runtime 11/11; browser: ровно 1 перехваченный POST | После deploy — владелец аналитики проверяет одну тестовую заявку по согласованной безопасной процедуре. |
| Квалификационные поля калькулятора терялись; пользовательский HTML требовал безопасного round-trip | Поля лида и безопасные статусы Telegram: `0c7e795`, `c92facf`, `71e830d` | Backend 14/14; browser подтвердил все 5 полей | Андрей: подтвердить, достаточно ли набора полей для продажи; это не блокирует техническую доставку. |
| CTA вызывали отсутствующую модалку или несуществующий target | Главная открывает существующую модалку, городские CTA ведут к `#callback`/телефону: `a11668b`, `5233dc3` | Contracts + 3 browser CTA journeys | После deploy — ручной smoke владельцем сайта на реальном домене. |
| Противоречивые цены, сроки, скидка, «без откачки», псевдолокальные кейсы/отзывы и география офисов | Неподтверждённые утверждения удалены, цены ограничены подтверждённым составом, городские тексты нейтрализованы: `937b811`, `92f2f9a`, `a63bdc3`, `d8119a6`, `c860112`, `8fd6027`, `1bed860` | Content/SEO/GEO contracts входят в 113 Python tests; crawler: 52 canonical/sitemap и 155 social/structured URL references; browser: 55 страниц | Андрей: закрыть реестр фактов; до этого удалённые claims не возвращать. |
| Gap навигации 769–1023 px, page-wide overflow таблиц, слабая клавиатурная/ARIA поддержка | Responsive navigation, FAQ, labels, dialog/menu semantics и runtime coverage: `cdbca68`, `522e6b7`, `7d7fc21`, `fbddfa3` | Accessibility 11/11; 220 browser runs на 360/768/900/1280 без overflow | Ручная проверка assistive technology после deploy желательна, но не заменяет уже пройденные контракты. |
| Метрика могла загружаться до явного согласия или дублироваться | Общий consent-gated loader с безопасным retry/dedupe: `3c3ec40`, `4760b2a`, `8b376ff` | Consent 11/11; browser до согласия: 0 `ym`, 0 тегов и 0 запросов Метрики | Владелец privacy/аналитики: проверить текст политики при изменении состава cookies. |
| Генераторы могли молча перезаписать страницы, выйти за output-root, зависеть от CRLF или оставить неверные права | Check-by-default, явный `--write`, LF contract, slug/containment/obsolete-output/mode/UTF-8 safety: `9e39785`, `300110a`, `85954e7` | Safety tests в Python suite; оба `--check` дают 12/12 | POSIX symlink/mode тесты дополнительно исполнятся в Linux CI; локально они пропущены по платформе. |
| Deploy смешивал ревизии, использовал mutable tag, мог пересекаться и создавал реальный тестовый лид | SHA images, подготовленные файлы той же ревизии, сериализация/stale guard, read-only health/page/Telegram smoke, pinned SSH actions: `75b8b61`, `1f8a65b` | 9 deploy contracts; YAML parse; Compose config с `test-sha` | Пользователь решает merge/deploy. Автоматический rollback остаётся отдельным архитектурным этапом. |
| Audit tooling не проверял social-image и schema URLs, принимал слишком широкий repository image fallback и пропускал `www` alias | Crawler и browser runner приведены к Docker contract: `html/images` имеет приоритет, только `/images/portfolio/**` получает fallback; отсутствующий `/images/og-image.jpg` заменён опубликованными тематическими URL; JSON-LD обход ограничен URL-bearing ключами и поддерживает относительные IRI | 7/7 crawler/report contracts; 6/6 browser safety; static crawl 2 774 references; Chromium 220/220 | При изменении Docker `COPY` синхронно обновлять resolver и его контрактные тесты. |
| Требовалась проверка уязвимостей всего проекта; свежая база advisory выявила parser-цепочку Express 4.22.2 | Точечно зафиксированы overrides `body-parser` 1.20.6 и `qs` 6.16.0, regenerated lock; добавлен реальный parser regression на обычные/вложенные/повторные поля, empty/malformed input и лимит 20 КБ | npm audits: 0; `npm ls` clean; form/backend 14/14; deploy contracts 9/9 | **Security owner:** планово мигрировать на Express 5 и убрать overrides после отдельной compatibility-проверки; повторно запустить Deep Security Scan после выдачи разрешения/TAC. Текущие проверки не равны полному security-аудиту. |

## Conversion, SEO/GEO, доступность, security и deploy

- **Conversion:** форма имеет одного владельца отправки; калькулятор передаёт квалификацию; ключевые CTA достигают формы/модалки/телефона. В браузерной проверке не отправлялись реальные лиды.
- **SEO/GEO:** 52 индексируемые canonical соответствуют sitemap один-к-одному; локальные ссылки, фрагменты, изображения и structured data разрешаются. Страницы сохраняют работу по всему Крыму и не изображают отдельные офисы/кейсы без доказательств.
- **Доступность:** проверены меню, модалки, FAQ, labels, таблицы и четыре целевых ширины. Это автоматизированная базовая проверка, не формальная сертификация WCAG.
- **Privacy/security:** Метрика закрыта явным согласием; production dependency audits чисты; HTML-экранирование лида покрыто тестами. Deep Security Scan не стартовал из-за недоступного разрешения/TAC, поэтому полный security-статус остаётся открытым.
- **Deploy:** workflow проверен только статически. Production-deploy, merge и rollback не выполнялись. Автоматический rollback намеренно остаётся отдельным решением после стабилизации атомарного deploy.

## Факты, ожидающие Андрея

Единый реестр, включая отдельные вопросы по генераторам и солнечным электростанциям: [andrey-confirmations-required.md](andrey-confirmations-required.md).

До документального подтверждения нельзя возвращать в публичный контент:

- один из годов основания (2015/2016), «200+ объектов», общую гарантию, схемы оплаты и единый срок монтажа;
- локальные кейсы/отзывы, цены и сроки кейсов, привязку фотографий и взаимодействие с СЭС;
- бурение скважин, тарифы/состав центральной канализации и прокладки труб, модели насосов;
- цены и комплектацию заборов, тарифы и границы работ по электроснабжению;
- новые модели/цены/наличие генераторов либо солнечные электростанции без нового подтверждённого материала.

## Воспроизведение

```powershell
$ErrorActionPreference = 'Stop'
function Invoke-Checked {
    param([scriptblock]$Command, [string]$Name)
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}
function Invoke-CheckedOutput {
    param([scriptblock]$Command, [string]$Name)
    $output = & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
    $output
}

Invoke-Checked { python -m unittest discover -s tests -p "test_*.py" -v } 'Python tests'
Invoke-Checked { npm ci } 'Root npm ci'
Invoke-Checked { npm audit --omit=dev } 'Root production audit'
Invoke-Checked { npm audit } 'Root full audit'
Invoke-Checked { node --test --test-isolation=none tests/test_audit_browser_safety.cjs } 'Browser safety tests'
$env:CI = 'true'
Invoke-Checked { node --test --test-isolation=none tests/test_form_runtime.cjs } 'Form runtime tests'
Invoke-Checked { node --test --test-isolation=none tests/test_analytics_consent_runtime.cjs } 'Consent runtime tests'
Invoke-Checked { node --test --test-isolation=none tests/test_accessibility_runtime.cjs } 'Accessibility runtime tests'
Push-Location form-handler
try {
    Invoke-Checked { npm ci } 'Form-handler npm ci'
    Invoke-Checked { npm test } 'Form-handler tests'
    Invoke-Checked { npm ls express body-parser qs --all } 'Form-handler dependency tree'
    Invoke-Checked { npm audit --omit=dev --json } 'Form-handler production audit'
    Invoke-Checked { npm audit } 'Form-handler full audit'
} finally {
    Pop-Location
}
Invoke-Checked { python scripts/validate.py } 'Pre-deploy validator'
Invoke-Checked { python scripts/audit-static-site.py } 'Static crawler'
Invoke-Checked { python generators/generate-city-indexes.py --check } 'City index generator check'
Invoke-Checked { python generators/generate-city-septik.py --check } 'City septic generator check'
$env:KEPSTROY_IMAGE_TAG = 'test-sha'
Invoke-Checked { docker compose config --quiet } 'Docker Compose config'
$runtimeJs = @('html/js/analytics-consent.js', 'html/js/blog-accordion.js', 'html/js/generatory.js', 'html/js/main.js', 'html/js/tracking.js', 'form-handler/index.js', 'form-handler/lead-message.js')
foreach ($file in $runtimeJs) { Invoke-Checked { node --check $file } "Syntax: $file" }
Invoke-Checked { node --check scripts/audit-browser-safety.cjs } 'Browser safety syntax'
Invoke-Checked { node --check scripts/audit-full-site-browser.cjs } 'Browser runner syntax'
Invoke-Checked { python -c "from pathlib import Path; import yaml; yaml.safe_load(Path('.github/workflows/deploy.yml').read_text(encoding='utf-8')); yaml.safe_load(Path('docker-compose.yml').read_text(encoding='utf-8')); print('YAML OK')" } 'YAML parse'
Invoke-Checked { node scripts/audit-full-site-browser.cjs } 'Full browser audit'
Invoke-Checked { git diff --check main...HEAD } 'Branch whitespace check'
Invoke-Checked { git diff --exit-code main...HEAD -- site site-ot-ai-google } 'Legacy diff check'
$changedFiles = Invoke-CheckedOutput { git diff --name-only main...HEAD } 'Branch filename inventory'
$secretLike = $changedFiles | Select-String -Pattern '(^|/)(\.env|.*secret|id_rsa|credentials)(\.|$)'
if ($secretLike) { $secretLike; throw 'Secret-like filenames found in branch diff.' }
Invoke-Checked { git status --short } 'Git status'
```

Следующий gate: повторный независимый code review после исправлений, затем отдельное решение пользователя о merge и production-deploy.
