# Analytics Notice Implementation Plan

> **For the agent:** REQUIRED SUB-SKILL: Use $executing-plans to implement this plan task-by-task.

**Goal:** Нижние кнопки доступны при открытом уведомлении; показ и закрытие измеряются отдельными целями Метрики.

**Architecture:** Изменения общего загрузчика аналитики, два события один раз за загрузку страницы. Нижний отступ рассчитывается по fixed-панели и обновляется при resize/ResizeObserver. Совместимое хранение ознакомления и немедленный запуск счётчика сохраняются.

**Tech Stack:** Vanilla JS/CSS, Node test runner, Playwright, Python unittest, MCP marketing-director, GitHub Actions.

---

## Task 1 — RED

- Baseline: `node --test tests/test_analytics_consent_runtime.cjs tests/test_form_runtime.cjs tests/test_callback_tracking.cjs`.
- В `tests/test_analytics_consent_runtime.cjs` добавить проверки: один show для отображённой плашки, отсутствие show для сохранённой отметки, один dismiss при закрытии, сохранение поведения без localStorage. Старые проверки init фильтровать по команде init, так как события теперь добавляются.
- Создать `tests/test_analytics_notice_browser.cjs`: локальный HTTP-сервер из html, запросы Метрики перехвачены, /submit заблокирован. Для main/solar/city и мобильных ширин проверить зазор плашка–нижние CTA, обычный клик по телефону, ровно один show/dismiss, скрытие при reload после закрытия, изменение viewport и desktop без панели.
- Запустить runtime и браузерные тесты; зафиксировать ожидаемые FAIL до изменения production-кода.

## Task 2 — GREEN и версия

- В `html/js/analytics-consent.js` добавить `noticeShownTracked=false`; после установки `banner.hidden` отправить show, если баннер виден и ещё не отмечен. Кнопка закрытия прекращает повторную обработку, сохраняет acknowledgement, скрывает плашку, вызывает dismiss. Любая ошибка аналитики не мешает скрытию.
- Отступ: для fixed-панели с ненулевой высотой взять `offsetHeight + max(0, computed bottom) + 12`; итог не меньше 16. Установить `banner.style.bottom`, пересчитывать при resize и ResizeObserver. Наблюдать только нужные элементы, таймеры и фоновые задачи не создавать.
- Удалить солнечное правило bottom=80px, которое конфликтует с общими стилями. Новый загрузчик ?v=3 во всех публичных HTML, шаблонах, контрактных тестах и валидаторе.
- Запустить новые тесты, полные Python readiness и валидатор, существующие frontend-тесты. Добавить браузерную проверку в CI.

## Task 3 — Проверка и публикация

- Проверить diff и репозиторий; подготовить краткий результат и риск измерения только новых визитов.
- Через MCP создать две отсутствующие action-цели с exact analytics_notice_shown / analytics_notice_dismissed, проверить readback; приоритетные цели рекламы не менять.
- Коммит подготовленного изменения, fast-forward main, push в согласованный production workflow. Дождаться success; проверить ожидаемый релиз и доступность MAX без отправки заявки.
- Live QA: плашка не перекрывает кнопки, show/dismiss и phone_click идут в Метрику и появляются в отдельном сегменте. Записать проверенные результаты. Не отправлять клиентское сообщение.

Рутинные выборы выполняются агентом в согласованном объёме; отдельный выбор метода выполнения или новое согласование дизайна не требуется.

## Выполнение перед публикацией

- RED: два runtime-теста падали из-за отсутствующих событий; браузерный тест подтвердил перекрытие панели на 320 px.
- GREEN: 28 frontend runtime, 185 Python readiness (6 платформенных пропусков), validator и 18 браузерных сценариев пройдены. При локальной проверке запросы аналитики перехвачены, отправок форм 0.
- Независимое чтение diff: критических и важных замечаний нет; дополнительно усилена проверка desktop → mobile на главной с появившейся sticky-панелью.
- Цели Метрики созданы через MCP и прочитаны обратно: `670445985` / `analytics_notice_shown`, `670446435` / `analytics_notice_dismissed`; обе `Active`, `action`, `exact`, не priority/retargeting. Изменений Директа нет.
- Публикация и live QA фиксируются отдельно по фактическому результату, не по запуску workflow.
