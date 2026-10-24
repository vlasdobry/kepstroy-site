# Form observability Implementation Plan

> **For the agent:** REQUIRED SUB-SKILL: Use $executing-plans to implement this plan task-by-task.

**Goal:** Make rejected form attempts visible in Metrika and correlate them with privacy-safe server outcomes without changing successful delivery or advertising optimization.

**Architecture:** Keep the existing forms, attribution, MAX/Telegram delivery and redirect contract. Add a server-generated request UUID, finite rejection reasons and response headers; client diagnostic goals receive only allowlisted reasons/status/UUID. Emit one structured completion record and correlated per-channel receipts without personal data. No database or external logging service.

**Tech Stack:** Existing static JS, Node20+, Express4, native crypto, Yandex Metrika management API. No new dependencies.

## Approved design and scope

The user authorized the first recommendation in the diagnostic report on 24 October: implement visible form errors and anonymized reasons. Existing generic alert, retry preservation and success goals remain. Diagnostic events `solar_submit_error` for solar forms and `form_submit_error` for other forms are secondary and must not enter Direct priority goals. Main alternatives were a goal alone (insufficient for root cause), this correlation layer (selected), and a separate logging service (unnecessary). The independent query cleanup keeps all existing groups and does not alter budget/strategy.

## Task 1: Specify and test outcomes

Files: `form-handler/test/submit-delivery.test.js`, `tests/test_form_runtime.cjs`, `tests/test_analytics_consent_runtime.cjs`.

Add meaningful failing tests for validation/delivery status and UUID correlation, privacy of logs, and client HTTP/network/preparation diagnostics. Analytics must forward only the finite diagnostic payload and no contact values. Run the targeted node tests and observe expected failures before implementation. Baseline: 43 passed.

## Task 2: Server implementation

Create `form-handler/submission-observability.js`; modify `form-handler/index.js`. Install observation before parsers for POST `/submit`; use `crypto.randomUUID()`, `X-Request-ID`, `X-Form-Error`; finish events contain only request ID, enum form kind/reason/status/duration. Give explicit reasons to all refusal branches, emit correlated MAX/Telegram outcomes, handle parser/CORS errors without raw exception output. Preserve redirects, honeypot, source validation, rate limits and CI test bypass.

## Task 3: Client implementation

Modify `html/js/main.js`, `tracking.js`, `analytics-consent.js`. Forward goal params safely; classify request preparation, network and HTTP errors. Use response headers only after enum/UUID validation. Keep success/primary goal behavior and form values. Update script cache versions in actual `html/` and generators/tests where required. No raw field, URL, referrer or exception text in diagnostic params.

## Task 4: Verify and publish

Run full form-handler tests, frontend runtime tests, Python readiness/validation and workflow checks; inspect diff and secrets. Create missing Metrika action goals through MCP, read back IDs and unchanged priority goals. Commit, integrate and use existing main-push deployment; verify CI, deployed hashes and health. Production validation uses harmless rejected POST without personal data or message delivery. Real delivery tests remain separately authorized.

## Task 5: Query cleanup and closeout

Independently obtain fresh campaign settings, prepare narrow negatives from all disclosed queries, test positive conflicts and preserve old negatives, apply through MCP/API and verify. Do not split groups. If write access is denied, use an available authorized UI; do not claim applied until readback. Save results and synchronize the two project Tasks with exact dates, verification and remaining limitations.
