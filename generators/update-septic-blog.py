#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Замена брендов и актуализация цен в блог-статьях про септики.
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
    # Бренды
    ('Топас 5', 'Панда Аэро'),
    ('Топас 4', 'Панда Лайт'),
    ('Топасом и Тверью', 'Панда Лайт и Панда Аэро'),
    ('Топас и Тверь', 'Панда Лайт и Панда Аэро'),
    ('«Топас»', '«Панда»'),
    ('«Тверь»', '«Панда Лайт»'),
    ('Топас', 'Панда'),
    ('Тверь', 'Панда Лайт'),
    ('«Панда» и «Панда Лайт»', '«Панда Лайт» и «Панда Аэро»'),
    ('«Панда Лайт» и «Панда Лайт»', '«Панда Лайт» и «Панда Аэро»'),
    ('«Панда» и «Панда»', '«Панда Лайт» и «Панда Аэро»'),
    ('Панда Лайт Лайт', 'Панда Лайт'),
    ('Панда Лайт Аэро', 'Панда Аэро'),
    
    # Цены
    ('45 000–80 000 ₽', '80 000–120 000 ₽'),
    ('45 000 – 80 000', '80 000 – 120 000'),
    ('45 000–80 000', '80 000–120 000'),
    ('55 000–90 000 ₽', '90 000–140 000 ₽'),
    ('55 000 – 90 000', '90 000 – 140 000'),
    ('55 000–90 000', '90 000–140 000'),
    ('55 000 – 85 000 ₽', '90 000 – 140 000 ₽'),
    ('55 000–85 000 ₽', '90 000–140 000 ₽'),
    ('60 000–90 000 ₽', '90 000–140 000 ₽'),
    ('60 000 – 90 000', '90 000 – 140 000'),
    ('60 000–90 000', '90 000–140 000'),
    ('40 000–80 000 ₽', '80 000–120 000 ₽'),
    ('40 000 – 80 000', '80 000 – 120 000'),
    ('40 000–80 000', '80 000–120 000'),
    ('100 000–160 000 ₽', '160 000–230 000 ₽'),
    ('100 000 – 160 000', '160 000 – 230 000'),
    ('100 000–160 000', '160 000–230 000'),
    ('50 000–80 000 ₽', '90 000–140 000 ₽'),
    ('50 000–80 000', '90 000–140 000'),
    ('35 000–70 000 ₽', '70 000–110 000 ₽'),
    ('35 000–70 000', '70 000–110 000'),
    ('25 000–45 000 ₽', '45 000–75 000 ₽'),
    ('25 000–45 000', '45 000–75 000'),
    ('40 000–90 000 ₽', '80 000–130 000 ₽'),
    ('40 000–90 000', '80 000–130 000'),
    ('30 000–80 000 ₽', '70 000–120 000 ₽'),
    ('30 000–80 000', '70 000–120 000'),
    ('50 000–75 000 рублей', '90 000–130 000 рублей'),
    ('90 000–140 000 рублей', '140 000–190 000 рублей'),
    ('180 000–250 000 рублей', '220 000–300 000 рублей'),
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
