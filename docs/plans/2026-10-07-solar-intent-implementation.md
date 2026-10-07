# Solar intent implementation plan

> **For the agent:** REQUIRED SUB-SKILL: Use $executing-plans to implement this plan task-by-task.

**Goal:** Preserve the buyer's panels/turnkey/installation choice through the contact form and align live advertising.

**Architecture:** Extend the existing shared solar script, not the form-handler. Add explicit intent attributes to shared generator templates and regenerate 13 pages. Keep commercial edits in a saved, validated API packet with fresh-state guards and readback.

**Tech Stack:** Vanilla JavaScript, Python generator, Node/Playwright tests, Yandex Direct MCP/API, GitHub Actions.

## Task 1 — Browser regression

- Create `tests/test_solar_intent_browser.cjs` with a self-contained local HTTP server and outside/POST interception, using the existing notice test pattern.
- Before production edits: run `node tests/test_solar_intent_browser.cjs` and observe failure that `panels` intent remains `turnkey`.
- Cases after implementation: 13 solar URLs × 390/1280px; hero/product/order intents, manually changing scenario, switching back while preserving user input, direct hash, final FormData, no duplicate goal.

## Task 2 — Shared page behavior

- Modify `html/js/solnechnye-paneli.js`: named scenario selection routes through existing render/sync behavior; delegated intent click listener; labels synchronized after every render; direct initial hash handled once.
- Modify `generators/solar-main-template.html` and `generators/solar-city-template.html`: add intent attributes to relevant CTA, label hooks and product title for the request heading; task-first default contact wording.
- Bump JS version in `generators/generate-solar-pages.py`; run `python generators/generate-solar-pages.py`.
- Add browser step to `.github/workflows/deploy.yml`.
- Run browser regression, `node --test tests/test_solar_calculator_runtime.cjs`, `python -m unittest discover -s tests -v`, `python scripts/validate.py`.

## Task 3 — Review and publish

- Use $requesting-code-review before merge; resolve findings and rerun affected checks.
- Commit explicit files, fast-forward main from clean state, push authorized production change; verify Actions and current images.
- Run the same commercial paths against the deployed site with POST and external analytics blocked; inspect labels and hidden message, without any real lead/call.

## Task 4 — Advertising package

- Refresh via `tmp/kepstroy-control-mcp.mjs cleanup-snapshot implementation-before` (already captured 06:23:25 UTC).
- Save before/after-ready JSON with two responsive ad messages, thirteen updated sitelink sets and three negative moves. Check official limits, historical semantics, IDs and invariants before writes.
- Prefer MCP; use API only for operations missing from MCP or unsafe integer-ID schemas. Do not cast 19-digit IDs to Number. Re-read state before changes and retain old records for rollback.
- Apply update once, inspect API results individually, then read back campaign/groups/ads/sitelinks; submit needed moderation and distinguish pending from accepted.

## Task 5 — Record

- Update the root marketing audit and deployment log with verified result, pending moderation or other real limitations, and next manual measurement.
- Prepare revised client status; do not send or mutate Google Tasks.
