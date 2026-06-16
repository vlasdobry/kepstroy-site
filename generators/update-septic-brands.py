#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Массовая замена Топас/Тверь на Панда и актуализация цен на септики.
"""

import os
import re

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML_DIR = os.path.join(BASE_DIR, 'html')

files = [
    'index.html',
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

# Порядок важен: сначала специфичные, потом общие
replacements = [
    # Модели
    ('Топас 5', 'Панда Аэро'),
    ('Топас 4', 'Панда Лайт'),
    ('Топас 8', 'Панда Аэро'),
    
    # Отзывы и сравнения
    ('Топасом и Тверью', 'Панда Лайт и Панда Аэро'),
    ('Топас и Тверь', 'Панда Лайт и Панда Аэро'),
    
    # Общие замены брендов
    ('«Топас»', '«Панда»'),
    ('«Тверь»', '«Панда Лайт»'),
    ('Топас', 'Панда'),
    ('Тверь', 'Панда Лайт'),
    
    # Фикс двойных «Панда» после замены
    ('«Панда» и «Панда Лайт»', '«Панда Лайт» и «Панда Аэро»'),
    ('«Панда Лайт» и «Панда Лайт»', '«Панда Лайт» и «Панда Аэро»'),
    ('«Панда» и «Панда»', '«Панда Лайт» и «Панда Аэро»'),
    ('септики «Панда Лайт» и «Панда Аэро»', 'станции Панда'),
    ('септики «Панда» и «Панда Лайт»', 'станции Панда'),
    ('септики «Панда» и «Панда»', 'станции Панда'),
    ('Септик «Панда Лайт»', 'Станция Панда Лайт'),
    ('Септик «Панда»', 'Станция Панда'),
    
    # Цены в таблицах
    ('80 000 – 110 000 ₽', '160 000 – 200 000 ₽'),
    ('80 000–110 000 ₽', '160 000–200 000 ₽'),
    ('100 000 – 140 000 ₽', '180 000 – 230 000 ₽'),
    ('100 000–140 000 ₽', '180 000–230 000 ₽'),
    
    # Минимальные цены (только для септиков в контексте этих страниц)
    ('от 60 000 ₽', 'от 140 000 ₽'),
    ('от 80 000 ₽', 'от 140 000 ₽'),
    
    # Фикс артефактов
    ('Панда Лайт Лайт', 'Панда Лайт'),
    ('Панда Лайт Аэро', 'Панда Аэро'),
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
