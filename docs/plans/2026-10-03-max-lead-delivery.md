# MAX Lead Delivery Implementation Plan

> **For the agent:** REQUIRED SUB-SKILL: Use $executing-plans to implement this plan task-by-task.

**Goal:** Подготовить независимую доставку заявок kepstroy.ru в закрытую группу MAX до завершения модерации бота.

**Architecture:** Оставить существующую валидацию и текст заявки; вынести MAX transport и выбор успешного канала в отдельные модули. Разрешить Telegram-only, MAX-only и оба канала; успех формы требует подтверждения хотя бы одного. Токены поступают только через environment, доверие дополнительному CA ограничено HTTPS-agent MAX.

**Tech Stack:** CommonJS / Node 20, express, существующий node-fetch, node:test, Docker Compose и GitHub Actions.

---

### Task 1: Контракт отправки и подтверждения

Files: Create `form-handler/test/delivery.test.js`, `form-handler/test/max-client.test.js`; Create `form-handler/lead-delivery.js`, `form-handler/max-client.js`.

1. Написать тесты sendMaxMessage: фиксированный официальный endpoint, Authorization, строковый chat_id, текст без потери HTML-символов, кнопка звонка, успешный message.body.mid.
2. Запустить `node --test test/max-client.test.js test/delivery.test.js`; подтвердить падение из-за отсутствующей реализации.
3. Реализовать два небольших модуля: bounded fetch, split <=4000 code points, задержка частей >=500ms, no raw errors, Promise.any для независимых каналов.
4. Повторить тесты; HTTP/API ошибки и неверное подтверждение должны отклонять доставку.

### Task 2: Подключение /submit

Files: Modify `form-handler/index.js`; Create `form-handler/test/submit-delivery.test.js`.

1. Написать HTTP-тесты с перехватом только внешнего node-fetch: успех после MAX при отказе/зависании Telegram, обратный случай, оба отказали =>500, оба успешны, MAX-only, CI и антиспам не отправляют.
2. Увидеть падение нового fallback-теста на существующей Telegram-only реализации.
3. Подключить независимую отправку вместо await sendTelegramMessage; сохранить redirect, recordSubmission и обработку form_submit на frontend. Проверять Telegram data.ok, ограничить fetch, убрать raw error/PII из затронутых журналов.
4. `npm test` в form-handler и `node --test tests/test_form_runtime.cjs` из корня должны пройти.

### Task 3: Конфигурация, TLS и эксплуатация

Files: Modify `form-handler/Dockerfile`, `docker-compose.yml`, `.github/workflows/deploy.yml`, `form-handler/package.json`; Add `form-handler/certs/russian-trusted-root-ca.crt`, `form-handler/max-setup.js`, `form-handler/README.md`.

1. Добавить проверенный публичный CA с официального источника, manifest происхождения и fingerprint; отдельный agent, не NODE_TLS_REJECT_UNAUTHORIZED=0.
2. Прокинуть optional MAX_BOT_TOKEN/MAX_CHAT_ID через secrets и Compose; ограничить права .env, не печатать секреты. Deploy connectivity должен проходить при доступности любого настроенного канала.
3. Команды setup: discover через bot_added updates, check через /me и членство, send-test только явным режимом; токен не передавать в аргументах.
4. Проверить все тесты, синтаксис, docker compose config; Docker build при доступном daemon. Если Docker daemon отсутствует — явно отметить ограничение проверки.
5. Сохранить инструкцию активации и результат тестов. Подготовить локальный коммит в feature-ветке; push/production выполнять на этапе подключения после получения токена.

## Выполнение 03.10.2026

- Реализация подготовлена в изолированном worktree `.worktrees/max-lead-delivery`, ветка `feat/max-lead-delivery`; `main` и production не менялись.
- RED→GREEN подтверждён для исходного fallback `/submit` (раньше Telegram error давал500 даже при MAX), модулей транспорта/setup, закрытия непрочитанного error response, ограничения очереди и конкурентного дубликата формы.
- Независимое ревью обнаружило неограниченное ожидание MAX; добавлены bounded FIFO, удаление expired без отправки, общий active budget и резервирование in-flight заявок. Безопасные детальные категории HTTP-ошибок остаются необязательным улучшением; сырые API ошибки не логируются.
- `npm test` обработчика: 51/51; frontend form/callback/analytics: 24/24; Python readiness: 185 тестов, 6 skipped, failures0.
- `python scripts/validate.py`, JS syntax, YAML parse, `bash -n` для deploy script, `docker compose config --quiet`, `git diff --check` — успешно. `npm audit --omit=dev --offline` сообщил0 vulnerabilities; это не онлайн-обновление advisory базы.
- Docker image build не выполнен: локальный daemon недоступен. Тесты исполнены локально на Node24; production/CI Node20 требуется проверить при сборке.
- Токен, ID группы, production smoke и подтверждение Андрея ожидаются после модерации. Задачу полной доставки не закрывать до этих проверок.
