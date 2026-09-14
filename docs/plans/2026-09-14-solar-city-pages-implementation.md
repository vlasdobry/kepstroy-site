# Solar City Landing Pages Implementation Plan

> **For the agent:** REQUIRED SUB-SKILL: Use $executing-plans to implement this plan task-by-task.

**Goal:** Выпустить 12 уникальных SEO/GEO-страниц солнечных панелей для существующих городов Крыма с централизованным обновлением общего оффера.

**Architecture:** Новый безопасный статический генератор рендерит общекрымскую страницу и 12 городских страниц из общего файла оффера, двух шаблонов и проверенных локальных текстов. Текущий городской реестр остаётся источником slug и падежей; generator drift, sitemap, llms, перелинковка и формы защищаются тестами.

**Tech Stack:** Python 3.12, `string.Template`, JSON, HTML5, CSS, vanilla JavaScript, JSON-LD, Python `unittest`, Node test runner, Playwright, Docker/nginx.

**Approved design:** `docs/plans/2026-09-14-solar-city-pages-design.md`.

---

### Task 1: Зафиксировать контракт 12 городских URL падающими тестами

**Files:**

- Create: `tests/test_solar_city_pages.py`
- Modify: `scripts/readiness_checks.py`

**Step 1: Написать тест точного городского набора**

Из `generators/city-septik-data.json` получить 12 slug и потребовать страницы:

```python
CITY_URL = "/krym/{slug}/solnechnye-paneli/"

def test_exactly_twelve_city_solar_pages_exist(self):
    expected = {city["slug"] for city in self.cities}
    actual = {
        path.parent.parent.name
        for path in HTML.glob("krym/*/solnechnye-paneli/index.html")
    }
    self.assertEqual(expected, actual)
```

**Step 2: Написать SEO/GEO-контракт**

Для каждой страницы проверить:

- self-canonical `/krym/{slug}/solnechnye-paneli/`;
- один H1 с услугой и корректным предложным падежом города;
- уникальные `title`, `description`, H1 и локальный блок;
- прямой оффер в первых 80 словах после H1;
- `650 Вт`, `20 000 ₽`, наличие/заказ, монтаж и типы систем;
- видимый серверный HTML без зависимости от JavaScript;
- BreadcrumbList, Service, Product/Offer и FAQPage;
- `areaServed` содержит City и Republic of Crimea, но не выдуманный PostalAddress.

**Step 3: Написать контракт ограничений**

Применить к общей и городским страницам существующие запреты на КПД 24,6%, неподтверждённые гарантии, окупаемость, выработку, фиксированные сроки, бесплатную доставку/монтаж и полную независимость. Потребовать явное пояснение, что 20 000 ₽ относится только к панели.

**Step 4: Написать контракт формы и перелинковки**

Потребовать на каждой странице:

- `form_source=kepstroy`;
- `service=Солнечные панели и электростанции`;
- предзаполненный населённый пункт или отдельное квалификационное поле города;
- ссылку на `/uslugi/solnechnye-paneli/` и `/krym/{slug}/`;
- ссылку с соответствующего городского хаба обратно на локальную страницу.

**Step 5: Добавить readiness-проверки**

В `scripts/readiness_checks.py` добавить точный городской набор, self-canonical, запреты оффера, город в форме и отсутствие ручного дрейфа.

**Step 6: Запустить тест и подтвердить RED**

Run:

```powershell
python -m unittest tests.test_solar_city_pages -v
```

Expected: FAIL, потому что 12 файлов отсутствуют.

**Step 7: Commit**

```powershell
git add tests/test_solar_city_pages.py scripts/readiness_checks.py
git commit -m "test: define solar city page contract"
```

### Task 2: Создать безопасный единый генератор 13 страниц

**Files:**

- Create: `generators/solar-page-data.json`
- Create: `generators/solar-city-content.json`
- Create: `generators/solar-main-template.html`
- Create: `generators/solar-city-template.html`
- Create: `generators/generate-solar-pages.py`
- Modify: `tests/test_generators_safety.py`
- Modify: `tests/test_solar_panels_page.py`

**Step 1: Написать падающие safety-тесты генератора**

Потребовать:

- `render_pages()` возвращает ровно 13 путей;
- основной путь равен `uslugi/solnechnye-paneli/index.html`;
- остальные пути соответствуют 12 slug;
- неизвестный/повторный/опасный slug отклоняется до записи;
- локальный контент содержит ровно те же slug, что городской реестр;
- `--check` не пишет файлы;
- `--write` использует атомарную замену и не удаляет неожиданные файлы;
- CRLF checkout не создаёт ложный drift.

**Step 2: Запустить safety-тест и подтвердить RED**

```powershell
python -m unittest tests.test_generators_safety -v
```

Expected: FAIL, новый модуль генератора отсутствует.

**Step 3: Зафиксировать общий оффер**

В `solar-page-data.json` хранить только подтверждённые общие значения:

```json
{
  "product_name": "LONGi Hi-MO X10 Scientist",
  "panel_power_w": 650,
  "panel_power_kw": 0.65,
  "panel_price_rub": 20000,
  "availability": ["В наличии", "Под заказ"],
  "system_types": ["Автономная", "Сетевая", "Гибридная"]
}
```

Не добавлять в данные КПД, гарантию, срок поставки или окупаемость.

**Step 4: Реализовать API генератора**

Минимальный публичный API:

```python
def load_inputs(...): ...
def validate_inputs(cities, city_content, offer): ...
def render_pages(...): ...
def compare_outputs(rendered, output_root): ...
def unexpected_outputs(rendered, output_root): ...
def atomic_write(path, html): ...
def execute(args): ...
```

Использовать `html.escape` для plain-text городских данных, `SLUG_PATTERN`, `Path.resolve`, `relative_to`, `mkstemp`, `fsync`, `os.replace` и сохранение mode существующего файла.

**Step 5: Превратить текущую общую страницу в шаблон**

`solar-main-template.html` должен воспроизводить текущий опубликованный HTML, но получать общие значения оффера из JSON. Добавить placeholder городской сетки. `tests/test_solar_panels_page.py` должен проверять опубликованный файл, а generator test — его отсутствие drift.

**Step 6: Запустить тесты и подтвердить GREEN**

```powershell
python -m unittest tests.test_generators_safety tests.test_solar_panels_page -v
python generators/generate-solar-pages.py --check
```

Expected: safety-тесты проходят; `--check` пока сообщает отсутствующие городские outputs.

**Step 7: Commit**

```powershell
git add generators tests/test_generators_safety.py tests/test_solar_panels_page.py
git commit -m "feat: add solar page generator"
```

### Task 3: Написать уникальные локальные данные и сгенерировать страницы

**Files:**

- Modify: `generators/solar-city-content.json`
- Modify: `generators/solar-city-template.html`
- Modify: `generators/solar-main-template.html`
- Modify: `html/uslugi/solnechnye-paneli/index.html`
- Create: `html/krym/*/solnechnye-paneli/index.html` (12 generated files)
- Modify: `html/css/solnechnye-paneli.css`
- Test: `tests/test_solar_city_pages.py`

**Step 1: Заполнить локальный контент 12 городов**

Для каждого slug добавить plain-text поля:

```json
{
  "slug": "simferopol",
  "intro": "...",
  "planning_paragraphs": ["...", "..."],
  "planning_points": ["...", "...", "..."],
  "local_faq_question": "...",
  "local_faq_answer": "..."
}
```

Каждый локальный блок должен быть смыслово уникальным, содержать не менее двух абзацев и трёх квалификационных пунктов. Не публиковать локальные значения инсоляции, ветровой нагрузки, выработки и окупаемости без источника. Географические условия описывать условно.

**Step 2: Собрать городской шаблон**

Переиспользовать CSS/JS и структуру общей страницы. Уникализировать metadata, H1, первые предложения, локальный блок и один FAQ. Добавить сетку соседних городов без более чем четырёх ссылок.

**Step 3: Добавить городскую сетку на общую страницу**

Вывести все 12 городов в отдельной секции с прямыми ссылками на локальные URL. Заголовок должен объяснять, что КэпСтрой выполняет подбор, доставку и монтаж по всему Крыму.

**Step 4: Запустить генератор в write-режиме**

```powershell
python generators/generate-solar-pages.py --write
python generators/generate-solar-pages.py --check
```

Expected: 13 опубликованных файлов совпадают с генератором.

**Step 5: Запустить контракты**

```powershell
python -m unittest tests.test_solar_city_pages tests.test_solar_panels_page -v
```

Expected: контракты опубликованных страниц, метаданных, контента, Schema и формы проходят. Тест двусторонней ссылки из городского хаба остаётся ожидаемо RED до Task 4; никаких других failures нет.

**Step 6: Commit**

```powershell
git add generators html/uslugi/solnechnye-paneli html/krym/*/solnechnye-paneli html/css/solnechnye-paneli.css
git commit -m "feat: generate solar pages for twelve cities"
```

### Task 4: Связать городские хабы и локальные солнечные страницы

**Files:**

- Modify: `generators/city-index-template.html`
- Modify: `html/krym/*/index.html` (generated)
- Modify: `generators/solar-main-template.html`
- Modify: `generators/solar-city-template.html`
- Modify: `tests/test_solar_city_pages.py`
- Modify: `tests/test_footer_services.py` only if contracts require the new nested routes

**Step 1: Добавить падающий тест двусторонней перелинковки**

Потребовать, чтобы `/krym/{slug}/` ссылался на `/krym/{slug}/solnechnye-paneli/`, а локальная солнечная страница — на собственный хаб и общую страницу. Проверить, что старая общая solar-ссылка не остаётся основной карточкой города.

**Step 2: Запустить тест и подтвердить RED**

```powershell
python -m unittest tests.test_solar_city_pages.SolarCityPagesTests.test_bidirectional_city_links -v
```

Expected: FAIL, хабы ведут на `/uslugi/solnechnye-paneli/`.

**Step 3: Обновить исходный городской шаблон**

В `generators/city-index-template.html` использовать `$slug` в локальном solar URL и текст с городом. Не менять ссылки генераторов/электроснабжения, которые должны остаться общекрымскими.

**Step 4: Перегенерировать городские хабы и solar pages**

```powershell
python generators/generate-city-indexes.py --write
python generators/generate-solar-pages.py --write
python generators/generate-city-indexes.py --check
python generators/generate-solar-pages.py --check
```

**Step 5: Проверить интеграцию**

```powershell
python -m unittest tests.test_solar_city_pages tests.test_footer_services -v
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add generators/city-index-template.html html/krym generators/solar-main-template.html generators/solar-city-template.html tests
git commit -m "feat: connect solar city landing pages"
```

### Task 5: Добавить sitemap и GEO-файлы

**Files:**

- Modify: `html/sitemap.xml`
- Modify: `html/llms.txt`
- Modify: `html/llms-full.txt`
- Verify: `html/robots.txt`
- Modify: `tests/test_solar_city_pages.py`

**Step 1: Добавить падающий индексирующий контракт**

Потребовать каждый из 12 canonical URL ровно один раз в sitemap и `llms-full.txt`. В `llms.txt` добавить компактный раздел региональных solar-страниц без повторения неподтверждённых обещаний.

**Step 2: Запустить тест и подтвердить RED**

```powershell
python -m unittest tests.test_solar_city_pages.SolarCityPagesTests.test_sitemap_and_ai_files -v
```

Expected: FAIL, новые URL не перечислены.

**Step 3: Обновить индексируемые файлы**

Добавить 12 URL с `lastmod=2026-09-14`. Общая солнечная страница остаётся в sitemap. В AI-файлах указать только общий подтверждённый оффер и список локальных маршрутов.

**Step 4: Проверить robots**

Подтвердить разрешение YandexBot, YandexImages, ChatGPT-User, Claude-SearchBot и PerplexityBot. Не менять файл без выявленного блока.

**Step 5: Запустить SEO/GEO-проверки**

```powershell
python scripts/validate.py
python scripts/audit-static-site.py
python -m unittest tests.test_solar_city_pages -v
```

Expected: `indexable_pages=65`, `sitemap_urls=65`, без orphan/dubious canonical.

**Step 6: Commit**

```powershell
git add html/sitemap.xml html/llms.txt html/llms-full.txt tests/test_solar_city_pages.py
git commit -m "feat: index solar city pages"
```

### Task 6: Передать город и расчёт в заявку

**Files:**

- Modify: `generators/solar-city-template.html`
- Modify: `html/js/solnechnye-paneli.js`
- Modify: `tests/test_solar_calculator_runtime.cjs`
- Modify: `tests/solar-panels-browser.cjs`
- Regenerate: `html/krym/*/solnechnye-paneli/index.html`

**Step 1: Добавить падающий runtime-тест**

Расширить `buildLeadMessage` квалификацией города и проверить, что город попадает в текст один раз даже при пустом пользовательском комментарии.

**Step 2: Запустить Node-тест и подтвердить RED**

```powershell
node --test --test-isolation=none tests/test_solar_calculator_runtime.cjs
```

Expected: FAIL, city ещё не сериализуется.

**Step 3: Реализовать минимальную передачу города**

Городская страница задаёт начальное значение населённого пункта и `data-service-area`. JS читает его, сохраняет редактируемость поля и включает город в `message`. Значение `service` остаётся стабильным для группировки лидов.

**Step 4: Добавить браузерную проверку payload**

На `/krym/jalta/solnechnye-paneli/` перехватить `/submit` и потребовать:

- `service=Солнечные панели и электростанции`;
- `message` содержит `Населённый пункт: Ялта`;
- расчёт 10 панелей, 6,5 кВт и 200 000 ₽;
- UTM/yclid, landing/current page и client ID;
- один POST при двойном нажатии.

**Step 5: Перегенерировать и запустить тесты**

```powershell
python generators/generate-solar-pages.py --write
node --test --test-isolation=none tests/test_solar_calculator_runtime.cjs
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add html/js/solnechnye-paneli.js generators/solar-city-template.html html/krym tests
git commit -m "feat: qualify solar leads by city"
```

### Task 7: Расширить браузерный аудит на новые страницы

**Files:**

- Modify: `tests/solar-panels-browser.cjs`
- Modify: `scripts/audit-full-site-browser.cjs`

**Step 1: Добавить RED для инвентаря**

Обновить ожидаемое число публичных HTML с 56 до 68. До генерации полный аудит должен упасть на неверном количестве.

**Step 2: Проверить все 12 городских страниц**

В безопасном локальном тесте, который разрешает только `127.0.0.1` и перехватывает POST/Метрику/внешние ресурсы, проверить:

- HTTP 200 и self-canonical;
- уникальный H1;
- отсутствие horizontal overflow на 360, 390, 768, 900, 1024, 1280, 1440;
- видимые CTA и навигацию;
- декодирование изображений;
- работоспособность FAQ;
- отсутствие pageerror.

На одном городе полностью пройти клавиатуру, calculator/form error/success и reduced motion.

**Step 3: Запустить локальный сценарий**

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory html
node tests/solar-panels-browser.cjs http://127.0.0.1:8765
```

Expected: PASS; только два перехваченных тестовых POST, ни одного реального.

**Step 4: Запустить весь браузерный сайт**

```powershell
node scripts/audit-full-site-browser.cjs
```

Expected: `68 × 4 = 272` page-width runs, no errors or server writes.

**Step 5: Снять контрольные скриншоты**

Сохранить общую страницу и Ялту на mobile/desktop в игнорируемой папке `html/screenshots/solnechnye-paneli/`. Проверить перенос H1, локальный блок, городскую сетку, калькулятор, форму, sticky CTA и уведомление Метрики.

**Step 6: Commit**

```powershell
git add tests/solar-panels-browser.cjs scripts/audit-full-site-browser.cjs
git commit -m "test: cover solar city journeys"
```

### Task 8: Финальная проверка и документация

**Files:**

- Modify: `docs/solar-panels-page.md`
- Modify: `docs/plans/2026-09-14-solar-city-pages-implementation.md` only to mark completion

**Step 1: Выполнить content review**

Проверить все 13 страниц:

- цена относится только к панели;
- нет неподтверждённых характеристик, гарантий, сроков и окупаемости;
- локальные тексты не утверждают одинаковые условия для всех объектов города;
- нет фальшивого местного адреса/офиса;
- FAQ visible/JSON-LD совпадают;
- общая информация согласована на всех страницах.

**Step 2: Запустить полный локальный gate**

```powershell
python -m unittest discover -s tests -v
python scripts/validate.py
python scripts/audit-static-site.py
python generators/generate-city-indexes.py --check
python generators/generate-solar-pages.py --check
node --test --test-isolation=none tests/test_solar_calculator_runtime.cjs
node --test --test-isolation=none form-handler/test/dependency-security.test.js form-handler/test/lead-message.test.js form-handler/test/tracking.test.js
node --check html/js/solnechnye-paneli.js
$env:KEPSTROY_IMAGE_TAG='solar-city-check'; docker compose config --quiet
docker build -t kepstroy-site:solar-city-check .
```

Expected: все команды exit 0; static audit сообщает 68 HTML, 65 indexable и 65 sitemap URL.

**Step 3: Проверить файлы внутри образа**

Одноразовым read-only контейнером подтвердить наличие общей страницы, одного городского HTML, CSS, JS и WebP в `/usr/share/nginx/html/`.

**Step 4: Обновить документацию**

В `docs/solar-panels-page.md` описать 12 URL, генератор, входные данные, команду массового обновления, SEO/GEO-контракт, форму и материалы для дальнейшего усиления.

**Step 5: Commit**

```powershell
git add docs/solar-panels-page.md docs/plans/2026-09-14-solar-city-pages-implementation.md
git commit -m "docs: document solar city release"
```

**Step 6: Остановиться перед внешними изменениями**

Не выполнять merge, push, deploy, реальную заявку, переобход Яндекс.Вебмастера или запуск рекламы без отдельного разрешения пользователя.
