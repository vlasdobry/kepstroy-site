"""Run repository regression with bounded UTF-8 diagnostics, preserving full local details."""
import io
import json
import sys
import unittest
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
sys.path.insert(0, str(root / 'tests'))
pattern = sys.argv[1] if len(sys.argv) > 1 else 'test_*.py'
suite = unittest.defaultTestLoader.discover(str(root / 'tests'), pattern=pattern)
buffer = io.StringIO()
result = unittest.TextTestRunner(stream=buffer).run(suite)
out = root / 'tmp/utility-qa'
out.mkdir(parents=True, exist_ok=True)
(out / ('regression-' + pattern.replace('*', 'all') + '.log')).write_text(buffer.getvalue(), encoding='utf-8')
summary = {'tests': result.testsRun, 'skipped': len(result.skipped), 'failures': [{'test': test.id(), 'trace': '\n'.join(trace.splitlines()[:8])[:1000]} for test, trace in result.failures], 'errors': [{'test': test.id(), 'trace': '\n'.join(trace.splitlines()[:8])[:1000]} for test, trace in result.errors]}
print(json.dumps(summary, ensure_ascii=True))
sys.exit(0 if result.wasSuccessful() else 1)
