#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Второй проход по блогу: оставшиеся заниженные цены.
"""

import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML_DIR = os.path.join(BASE_DIR, 'html')

files = [
    'blog/septik-yalta/index.html',
    'blog/kak-vybrat-septik-dlya-chastnogo-doma-v-krymu/index.html',
    'blog/ustanovka-septika-krym/index.html',
    'blog/skolko-stoit-septik-pod-klyuch-krym/index.html',
    'blog/kanalizaciya-v-chastnom-dome-krym/index.html',
    'blog/zhibi-ili-plastik-septik-krym/index.html',
    'blog/septik-dlya-dachi-krym/index.html',
    'blog/septik-simferopol/index.html',
    'blog/septik-sevastopol/index.html',
    'blog/septik-ili-vygrebnaya-yama-krym/index.html',
]

replacements = [
    ('45 000–75 000 ₽', '80 000–110 000 ₽'),
    ('45 000–75 000', '80 000–110 000'),
    ('55 000–80 000 ₽', '90 000–120 000 ₽'),
    ('55 000–80 000', '90 000–120 000'),
    ('45 000 – 70 000', '80 000 – 120 000'),
    ('45 000–70 000', '80 000–120 000'),
    ('от 55 000 ₽', 'от 90 000 ₽'),
    ('35 000–60 000 ₽', '70 000–100 000 ₽'),
    ('35 000–60 000', '70 000–100 000'),
    ('50 000–95 000 ₽', '90 000–130 000 ₽'),
    ('50 000–95 000', '90 000–130 000'),
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
