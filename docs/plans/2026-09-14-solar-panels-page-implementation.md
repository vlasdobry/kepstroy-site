# Solar Panels Landing Page Implementation Plan

> **For the agent:** REQUIRED SUB-SKILL: Use $executing-plans to implement this plan task-by-task.

**Goal:** Выпустить отдельную конверсионную страницу продажи солнечных панелей и солнечных электростанций под ключ по всему Крыму.

**Architecture:** Статическая индексируемая страница `/uslugi/solnechnye-paneli/` использует общий `style.css`, `main.js`, `tracking.js`, действующий POST `/submit` и изолированные page-local CSS/JS. Калькулятор считает только установленную мощность и стоимость панелей; выбранные параметры сериализуются в заявку без изменения публичного API формы. Все входящие ссылки добавляются одновременно в опубликованные HTML и исходные шаблоны генераторов.

**Tech Stack:** HTML5, CSS, vanilla JavaScript, JSON-LD, Python `unittest`, Node test runner, Playwright, существующие Docker/nginx/GitHub Actions.

**Approved design:** `docs/plans/2026-09-14-solar-panels-page-design.md`.

**Execution context:** выполнять в отдельном git worktree/feature-ветке. Не менять legacy-папки за пределами `kepstroy-site/`.

---

### Task 1: Зафиксировать контракт страницы падающими тестами

**Files:**

- Create: `tests/test_solar_panels_page.py`
- Modify: `scripts/readiness_checks.py`

**Step 1: Написать тест существования и SEO-контракта**

Проверить:

```python
URL = "/uslugi/solnechnye-paneli/"

def test_page_metadata_schema_and_single_h1(self):
    text = self.page()
    self.assertEqual(1, len(re.findall(r"<h1\\b", text)))
    self.assertIn('href="https://kepstroy.ru/uslugi/solnechnye-paneli/"', text)
    self.assertIn("Солнечные панели и электростанции под ключ в Крыму", text)
```

Разобрать все JSON-LD и потребовать типы `Service`, `Product`, `BreadcrumbList`, `FAQPage`, `Person`; в `Offer` проверить `price=20000`, `priceCurrency=RUB`, `availability=https://schema.org/InStock`. Не требовать SKU, GTIN, рейтинги или гарантию.

**Step 2: Написать тест границ оффера**

Потребовать видимые факты `650 Вт`, `20 000 ₽`, `в наличии`, `под заказ`, `по всему Крыму`. Запретить регистронезависимыми шаблонами:

```python
FORBIDDEN = [
    r"КПД[^<]{0,30}24[,.]6",
    r"окупаем",
    r"бесплатн[^<]{0,30}(?:достав|монтаж)",
    r"монтаж[^<]{0,30}(?:за|в течение) 1 (?:день|дня)",
    r"15-летн[^<]{0,30}гарант",
    r"30-летн[^<]{0,30}гарант",
    r"полная независимость",
]
```

**Step 3: Написать тест формы и калькулятора**

Проверить обязательный телефон, необязательные имя/комментарий, непредвыбранное обязательное согласие, `form_source=kepstroy`, `service=Солнечные панели и электростанции`, honeypot, диапазон количества 1–100 и наличие формул `0.65`/`20000` в page-local JS.

**Step 4: Написать тест интеграции**

Потребовать ровно одну запись URL в `sitemap.xml`, упоминание в `llms.txt`/`llms-full.txt`, ссылку с главной, `/krym/`, всех `/krym/*/`, `generators/city-index-template.html`, генераторов и электроснабжения. Убедиться, что городских страниц `*/solnechnye-paneli/` нет.

**Step 5: Добавить readiness-запреты**

В `scripts/readiness_checks.py` добавить проверку страницы на спорные КПД/гарантии/окупаемость и обязательное разделение строки «стоимость панелей» от монтажа/комплектующих.

**Step 6: Запустить тесты и подтвердить ожидаемое падение**

Run:

```powershell
python -m unittest tests.test_solar_panels_page -v
```

Expected: FAIL — `html/uslugi/solnechnye-paneli/index.html` отсутствует.

**Step 7: Commit**

```powershell
git add tests/test_solar_panels_page.py scripts/readiness_checks.py
git commit -m "test: define solar landing contract"
```

### Task 2: Создать и проверить изображения

**Files:**

- Create: `html/images/solnechnye-paneli/solar-hero-640.webp`
- Create: `html/images/solnechnye-paneli/solar-hero-960.webp`
- Create: `html/images/solnechnye-paneli/solar-panel-visualization.webp`
- Create: `docs/solar-page-assets.md`

**Step 1: Сгенерировать hero**

Использовать `$imagegen`, use case `ads-marketing`. Промпт:

```text
Asset type: landing-page hero.
Scene: modern detached house or small commercial building in a dry, sunny Crimean landscape; a technically plausible rooftop solar array; no identifiable address.
Composition: wide horizontal editorial photograph, panels on the right half, clean negative space on the left for HTML copy.
Style: natural architectural photography, realistic scale and materials, warm daylight, restrained colors compatible with a green-and-white engineering brand.
Constraints: no people, no text, no logos, no LONGi marks, no watermarks, no impossible wiring, no batteries outdoors.
```

**Step 2: Сгенерировать каталожную визуализацию панели**

```text
Asset type: product visualization for a landing page.
Subject: generic modern bifacial photovoltaic module with dark front surface, double-glass construction and aluminum frame.
Composition: clean three-quarter view on a neutral light background, enough edge detail to communicate product quality.
Constraints: no brand marks, no model number, no text, no watermark; do not reproduce a proprietary product photo.
```

**Step 3: Сохранить результаты в проекте**

Скопировать выбранные изображения из результата встроенного генератора в `html/images/solnechnye-paneli/`. Не оставлять используемые страницей файлы только в `$CODEX_HOME`. Создать версии 640/960, сохранить пропорции, проверить визуально и зафиксировать промпты/подписи в `docs/solar-page-assets.md`.

**Step 4: Проверить файлы**

Проверить, что каждый WebP открывается, hero-версии имеют одинаковое соотношение сторон, суммарный объём разумен для мобильного трафика и метаданные не содержат лишней геолокации.

**Step 5: Commit**

```powershell
git add html/images/solnechnye-paneli docs/solar-page-assets.md
git commit -m "feat: add solar landing visuals"
```

### Task 3: Собрать семантический HTML и дизайн страницы

**Files:**

- Create: `html/uslugi/solnechnye-paneli/index.html`
- Create: `html/css/solnechnye-paneli.css`
- Create: `html/js/solnechnye-paneli.js`
- Reference: `html/uslugi/generatory/index.html`
- Reference: `html/css/generatory.css`

**Step 1: Создать head и Schema**

Использовать точные Title, Description, canonical, OG и H1 из утверждённого дизайна. Подключить ровно один `/js/analytics-consent.js?v=2`, общий `/css/style.css`, новый page-local CSS, `/js/tracking.js`, `/js/main.js` и page-local JS.

JSON-LD оформить единым `@graph`; `FAQPage` должен дословно соответствовать видимому FAQ.

**Step 2: Создать структуру контента**

Реализовать секции в указанном порядке:

1. header + breadcrumbs + hero;
2. товар LONGi 650 Вт;
3. три варианта заказа;
4. автономная/сетевая/гибридная система;
5. калькулятор;
6. этапы работы;
7. FAQ;
8. форма;
9. связанные услуги;
10. общий footer и мобильный CTA.

Первые 80 слов должны содержать продавца, товар, цену, наличие, географию и доступный полный цикл работ.

**Step 3: Реализовать доступный page-local стиль**

Повторить ритм страницы генераторов без копирования названий `power-*`: использовать scoped-префикс `solar-`. Требования: `focus-visible`, skip-link, контраст, touch targets ≥44 px, один столбец на мобильном, `prefers-reduced-motion`, фиксированная мобильная CTA над cookie notice.

**Step 4: Подключить изображения**

Hero: `srcset` 640/960, `fetchpriority="high"`, точные размеры. Остальные: `loading="lazy"`, `decoding="async"`. Видимые подписи должны содержать слово «Визуализация».

**Step 5: Запустить статический тест**

Run:

```powershell
python -m unittest tests.test_solar_panels_page -v
```

Expected: часть тестов страницы PASS; интеграционные тесты ещё FAIL.

**Step 6: Commit**

```powershell
git add html/uslugi/solnechnye-paneli/index.html html/css/solnechnye-paneli.css html/js/solnechnye-paneli.js
git commit -m "feat: build solar panels landing page"
```

### Task 4: Реализовать калькулятор и передачу результата

**Files:**

- Modify: `html/uslugi/solnechnye-paneli/index.html`
- Modify: `html/js/solnechnye-paneli.js`
- Test: `tests/test_solar_calculator_runtime.cjs`

**Step 1: Написать unit/runtime-тест расчёта**

Экспортировать чистую функцию для Node без DOM:

```javascript
const calculatePanels = (quantity) => ({
  quantity,
  powerKw: Math.round(quantity * 0.65 * 100) / 100,
  panelsPrice: quantity * 20000,
});
```

Проверить:

```javascript
assert.deepEqual(calculatePanels(1), { quantity: 1, powerKw: 0.65, panelsPrice: 20000 });
assert.deepEqual(calculatePanels(10), { quantity: 10, powerKw: 6.5, panelsPrice: 200000 });
assert.deepEqual(calculatePanels(100), { quantity: 100, powerKw: 65, panelsPrice: 2000000 });
```

Некорректные, дробные и выходящие за диапазон значения должны нормализоваться или возвращать явную ошибку; поведение зафиксировать тестом.

**Step 2: Запустить тест и подтвердить падение**

Run:

```powershell
node --test tests/test_solar_calculator_runtime.cjs
```

Expected: FAIL до экспорта функции.

**Step 3: Реализовать интерактивность**

Обновлять результат без перезагрузки. При первом изменении отправлять `solar_calculator_start` один раз, при явном нажатии «Рассчитать» — `solar_calculator_result`. Установить `aria-live="polite"` на результат.

**Step 4: Сериализовать расчёт в заявку**

Перед submit формировать hidden `message` или объединять hidden `calculation_summary` с необязательным комментарием так, чтобы в Telegram пришли: сценарий, количество, 0,65×N кВт, стоимость панелей, тип системы, размещение и населённый пункт. Не передавать эти свободные строки в параметры Метрики.

Если используется новое поле вместо `message`, расширить allowlist/вывод `form-handler/lead-message.js` и добавить Node-тест. Предпочтительный MVP — сформировать безопасный `message` на фронтенде и не менять backend.

**Step 5: Проверить тесты**

Run:

```powershell
node --test tests/test_solar_calculator_runtime.cjs
python -m unittest tests.test_solar_panels_page -v
```

Expected: PASS для формул и статического контракта, кроме ещё не выполненной перелинковки.

**Step 6: Commit**

```powershell
git add html/uslugi/solnechnye-paneli/index.html html/js/solnechnye-paneli.js tests/test_solar_calculator_runtime.cjs
git commit -m "feat: add transparent solar calculator"
```

### Task 5: Встроить страницу в структуру сайта

**Files:**

- Modify: `html/index.html`
- Modify: `html/krym/index.html`
- Modify: `html/krym/*/index.html`
- Modify: `html/uslugi/generatory/index.html`
- Modify: `html/uslugi/elektrosnabzhenie/index.html`
- Modify: all production HTML footer service lists under `html/`
- Modify: `generators/city-index-template.html`
- Modify: `generators/city-septik-template.html`
- Modify: `generators/city-septik-data.json` only if generated contextual blocks contain the shared service list

**Step 1: Добавить карточку на главную**

Название: «Солнечные панели и электростанции».

Описание: «Панели LONGi 650 Вт, подбор инверторов и аккумуляторов, монтаж систем по всему Крыму.»

Цена: «20 000 ₽/шт.»

CTA: «Рассчитать систему».

Добавить `Offer` услуги в `OfferCatalog` главной и option `solnechnye-paneli` в общие формы выбора услуги.

**Step 2: Добавить ссылки в хабы**

Добавить одну карточку/ссылку на общекрымскую страницу в `/krym/`, 12 городских хабов и `generators/city-index-template.html`. Не создавать городские URL солнечной услуги.

**Step 3: Добавить взаимную перелинковку**

На генераторах: «Солнечные панели и гибридные системы». На электроснабжении: «Солнечная электростанция для объекта». На солнечной странице сохранить ссылки обратно.

**Step 4: Обновить все единые подвал-ссылки и шаблоны**

Добавить `/uslugi/solnechnye-paneli/` с подписью «Солнечные панели» во все production footer service lists и два source template. Не допускать расхождения между опубликованными файлами и генераторами.

**Step 5: Запустить генераторы в check-режиме**

Определить актуальные команды через `--help`, затем запустить оба генератора без записи. При дрейфе обновить данные/шаблоны и только потом выполнить контролируемую генерацию.

**Step 6: Запустить тесты**

Run:

```powershell
python -m unittest tests.test_solar_panels_page -v
python scripts/validate.py
```

Expected: PASS.

**Step 7: Commit**

```powershell
git add html generators tests/test_solar_panels_page.py
git commit -m "feat: link solar service across site"
```

### Task 6: Обновить sitemap, AI-файлы и индексируемые факты

**Files:**

- Modify: `html/sitemap.xml`
- Modify: `html/llms.txt`
- Modify: `html/llms-full.txt`
- Verify: `html/robots.txt`

**Step 1: Добавить URL в sitemap**

Добавить `https://kepstroy.ru/uslugi/solnechnye-paneli/` ровно один раз с датой содержательного обновления. Не добавлять якоря, калькулятор или llms-файлы.

**Step 2: Добавить краткий факт в llms.txt**

```markdown
- [Солнечные панели и электростанции](https://kepstroy.ru/uslugi/solnechnye-paneli/): LONGi Hi-MO X10 Scientist 650 Вт по 20 000 ₽/шт., в наличии и под заказ. Доставка, проектирование и монтаж систем по всему Крыму.
```

**Step 3: Добавить ограниченный раздел в llms-full.txt**

Перечислить только подтверждённые факты, типы систем и отдельный расчёт комплектующих/монтажа. Не переносить на солнечное направление общие гарантии, сроки, оплату или обещания других услуг.

**Step 4: Проверить robots**

Подтвердить, что поисковые и AI-краулеры не блокируются для нового URL. Без необходимости файл не менять.

**Step 5: Запустить SEO/GEO-контракты**

Run:

```powershell
python scripts/validate.py
python scripts/audit-static-site.py
python -m unittest discover -s tests -v
```

Expected: PASS, sitemap совпадает с индексируемыми canonical URL.

**Step 6: Commit**

```powershell
git add html/sitemap.xml html/llms.txt html/llms-full.txt
git commit -m "feat: index solar service"
```

### Task 7: Проверить браузерную воронку и доступность

**Files:**

- Create: `tests/solar-panels-browser.cjs`
- Modify: `scripts/audit-full-site-browser.cjs` if the fixed route inventory requires it

**Step 1: Создать браузерный тест на базе генераторов**

Тест должен запускаться только против `127.0.0.1`, перехватывать `/submit`, Метрику и внешние ресурсы, не отправлять реальные заявки.

Проверить ширины 360, 390, 768, 900, 1024, 1280, 1440:

- нет горизонтального overflow;
- видны навигация и CTA;
- меню управляется клавиатурой, Escape и focus trap;
- skip-link переносит фокус;
- FAQ раскрывается;
- калькулятор даёт 6,5 кВт и 200 000 ₽ для 10 панелей;
- обязательные поля блокируют submit;
- consent обязателен;
- ошибка 500 сохраняет данные и не вызывает `form_submit`;
- двойное нажатие создаёт один POST;
- успешный POST содержит услугу, расчёт, UTM, yclid, landing/current page и client ID;
- все изображения декодируются;
- `prefers-reduced-motion` соблюдается.

**Step 2: Запустить локальный сервер**

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory html
```

**Step 3: Запустить браузерный тест**

```powershell
node tests/solar-panels-browser.cjs http://127.0.0.1:8765
```

Expected: PASS, реальные POST и внешние события не отправлены.

**Step 4: Запустить полный аудит сайта**

```powershell
node scripts/audit-full-site-browser.cjs http://127.0.0.1:8765
```

Expected: PASS на всех production pages и контрольных ширинах.

**Step 5: Снять локальные скриншоты**

Сохранить mobile/desktop hero и full-page в игнорируемой папке `html/screenshots/solnechnye-paneli/`, визуально проверить подписи, переносы, калькулятор, sticky CTA и cookie notice.

**Step 6: Commit**

```powershell
git add tests/solar-panels-browser.cjs scripts/audit-full-site-browser.cjs
git commit -m "test: cover solar landing funnel"
```

### Task 8: Финальная локальная проверка и передача к публикации

**Files:**

- Modify: `docs/plans/2026-09-14-solar-panels-page-implementation.md` only to mark completed tasks
- Create: `docs/solar-panels-page.md`

**Step 1: Запустить полный набор проверок**

```powershell
python -m unittest discover -s tests -v
python scripts/validate.py
python scripts/audit-static-site.py
node --test tests/test_solar_calculator_runtime.cjs
node --test --test-isolation=none form-handler/test/*.test.js
node --check html/js/solnechnye-paneli.js
docker compose config --quiet
```

Expected: все команды PASS/exit 0.

**Step 2: Проверить сборку**

Run:

```powershell
docker build -t kepstroy-site:solar-check .
```

Expected: образ собирается; новые HTML/CSS/JS/WebP находятся в webroot образа.

**Step 3: Провести content diff review**

Проверить отдельно:

- нет спорного КПД 24,6% для 650 Вт;
- нет неподтверждённых гарантий, сроков и окупаемости;
- цена 20 000 ₽ относится только к панели;
- генераторы и солнечная система не представлены как автоматически совместимый комплект;
- визуализации честно подписаны;
- все изменённые footer/template списки совпадают.

**Step 4: Описать реализацию**

В `docs/solar-panels-page.md` указать URL, подтверждённые факты, формулу калькулятора, форму/аналитику, изображения, команды проверки и перечень материалов для последующего усиления.

**Step 5: Commit**

```powershell
git add docs/solar-panels-page.md docs/plans/2026-09-14-solar-panels-page-implementation.md
git commit -m "docs: document solar landing release"
```

**Step 6: Остановиться перед внешними изменениями**

Не выполнять push, deploy, переобход Яндекс.Вебмастера, запуск Яндекс.Директа или реальную тестовую заявку без отдельной команды пользователя.

После отдельного разрешения на публикацию:

1. push feature-ветки/утверждённого коммита;
2. дождаться успешного GitHub Actions;
3. проверить production HTTP 200, canonical, assets и security headers;
4. отправить одну контролируемую тестовую заявку и подтвердить получение/атрибуцию;
5. проверить цели в Яндекс.Метрике;
6. добавить URL в переобход Яндекс.Вебмастера;
7. только после этого направлять рекламный трафик.
