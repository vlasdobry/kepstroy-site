from pathlib import Path

root = Path(__file__).resolve().parents[1]
paths = [*(root / 'html').rglob('*.html'), *(root / 'generators').glob('*-template.html'), root / 'scripts/validate.py', root / 'tests/test_analytics_consent.py']
count = 0
for path in paths:
    text = path.read_text(encoding='utf-8')
    updated = text.replace('analytics-consent.js?v=4', 'analytics-consent.js?v=5').replace(r'analytics-consent\.js\?v=4', r'analytics-consent\.js\?v=5').replace('main.js?v=24', 'main.js?v=25')
    if updated != text:
        path.write_text(updated, encoding='utf-8', newline='\n')
        count += 1
print(f'Updated asset references in {count} files')
