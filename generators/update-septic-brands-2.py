#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Дополнительные замены: Панда → Панда Аэро в таблицах, цены ЖБ колец.
"""

import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML_DIR = os.path.join(BASE_DIR, 'html')

files = [
    'tseny/index.html',
    'krym/sudak/septik-pod-kluch/index.html',
    'krym/simferopol/septik-pod-kluch/index.html',
    'krym/sevastopol/septik-pod-kluch/index.html',
    'krym/saki/septik-pod-kluch/index.html',
    'krym/kerch/septik-pod-kluch/index.html',
    'krym/jalta/septik-pod-kluch/index.html',
    'krym/feodosija/septik-pod-kluch/index.html',
    'krym/evpatorija/septik-pod-kluch/index.html',
    'krym/dzhankoj/septik-pod-kluch/index.html',
    'krym/bahchisaraj/septik-pod-kluch/index.html',
    'krym/armjansk/septik-pod-kluch/index.html',
    'krym/alushta/septik-pod-kluch/index.html',
]

replacements = [
    ('Станция Панда (0,6–1,5 м³/сут)', 'Станция Панда Аэро (0,8–1,5 м³/сут)'),
    ('ЖБ кольца (2–3 м³)</td>\n                <td style="padding: 1rem; text-align: right; font-weight: 700; color: var(--color-primary);">60 000 – 90 000 ₽</td>', 'ЖБ кольца (2–3 м³)</td>\n                <td style="padding: 1rem; text-align: right; font-weight: 700; color: var(--color-primary);">140 000 – 180 000 ₽</td>'),
    ('ЖБ кольца (2–3 м³)</td>\n              <td style="padding: 1.25rem 1rem; text-align: right; font-weight: 800; color: var(--c-accent);">от 140 000 ₽</td>', 'ЖБ кольца (2–3 м³)</td>\n              <td style="padding: 1.25rem 1rem; text-align: right; font-weight: 800; color: var(--c-accent);">140 000 – 180 000 ₽</td>'),
]


def process_file(rel_path):
    full_path = os.path.join(HTML_DIR, rel_path)
    with open(full_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    original = content
    for old, new in replacements:
        content = content.replace(old, new)
    
    if content != original:
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'Обновлено: {rel_path}')
    else:
        print(f'Без изменений: {rel_path}')


def main():
    for rel_path in files:
        process_file(rel_path)


if __name__ == '__main__':
    main()
