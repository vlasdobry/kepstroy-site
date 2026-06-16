#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Дополнительные замены для blog/septik-simferopol.
"""

import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML_DIR = os.path.join(BASE_DIR, 'html')

file_path = os.path.join(HTML_DIR, 'blog/septik-simferopol/index.html')

replacements = [
    ('от 90 000 до 260 000 ₽', 'от 140 000 до 300 000 ₽'),
    ('55 000 – 75 000', '90 000 – 130 000'),
    ('45 000 – 55 000', '80 000 – 100 000'),
    ('45 000 – 65 000', '80 000 – 110 000'),
    ('55 000 – 80 000', '90 000 – 140 000'),
]

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

original = content
for old, new in replacements:
    content = content.replace(old, new)

if content != original:
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('Обновлено: blog/septik-simferopol/index.html')
else:
    print('Без изменений')
