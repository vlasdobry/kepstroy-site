import json
import re
import unittest
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / 'html'
URL = '/uslugi/generatory/'


class Elements(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.nodes = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        self.nodes.append((tag, dict(attrs)))


class GeneratorsPageTests(unittest.TestCase):
    def page(self):
        path = HTML / 'uslugi/generatory/index.html'
        self.assertTrue(path.exists(), 'Generator landing page must exist')
        return path.read_text(encoding='utf-8')

    def test_metadata_schema_and_single_h1(self):
        text = self.page()
        self.assertEqual(1, len(re.findall(r'<h1\b', text)))
        nodes = Elements(text).nodes
        self.assertIn(('link', {'rel': 'canonical', 'href': 'https://kepstroy.ru' + URL}), nodes)
        schemas = [json.loads(x) for x in re.findall(r'<script type="application/ld\+json">(.*?)</script>', text, re.S)]
        types = {item['@type'] for schema in schemas for item in schema.get('@graph', [schema])}
        self.assertTrue({'Service', 'BreadcrumbList', 'Person'} <= types)
        self.assertNotIn('noindex', text)

    def test_form_delivery_and_optional_context(self):
        text = self.page()
        nodes = Elements(text).nodes
        inputs = {a.get('name'): a for t, a in nodes if t in ('input', 'textarea')}
        self.assertEqual('tel', inputs['phone']['type'])
        self.assertIn('required', inputs['phone'])
        self.assertNotIn('required', inputs['name'])
        self.assertNotIn('checked', inputs['consent'])
        self.assertIn('required', inputs['consent'])
        self.assertEqual('Генераторы с установкой', inputs['service']['value'])
        self.assertEqual('kepstroy', inputs['form_source']['value'])
        self.assertTrue({'website', 'company', 'message'} <= inputs.keys())
        self.assertLessEqual(int(inputs['message']['maxlength']), 1000, 'Backend rejects fields over 1000 characters')
        self.assertIn('action="/submit"', text)
        self.assertIn('/js/tracking.js', text)
        self.assertIn('/js/main.js', text)

    def test_local_anchors_and_images(self):
        nodes = Elements(self.page()).nodes
        ids = [a['id'] for _, a in nodes if 'id' in a]
        self.assertEqual(len(ids), len(set(ids)))
        for tag, attrs in nodes:
            href = attrs.get('href', '')
            if href.startswith('#'):
                self.assertIn(href[1:], ids)
            if tag == 'img' and attrs.get('src', '').startswith('/'):
                self.assertTrue((HTML / attrs['src'].lstrip('/')).exists())
                self.assertTrue(attrs.get('alt'))
                self.assertIn('width', attrs)
                self.assertIn('height', attrs)

    def test_offer_boundaries(self):
        text = self.page()
        for forbidden in ['солнечн', 'Монтаж за 1 день', 'В наличии', 'окупаемость', '12000', '12 000']:
            self.assertNotIn(forbidden, text)
        self.assertIn('по всему Крыму', text)
        self.assertIn('Пример оборудования', text)
        self.assertIn('50 Гц', text)
        self.assertIn('АВР', text)

    def test_hubs_and_source_template_link_to_one_landing(self):
        paths = [HTML / 'index.html', HTML / 'krym/index.html', ROOT / 'generators/city-index-template.html']
        paths += list((HTML / 'krym').glob('*/index.html'))
        paths += [HTML / f'uslugi/{service}/index.html' for service in ('gazosnabzhenie', 'elektrosnabzhenie')]
        for path in paths:
            self.assertIn(f'href="{URL}"', path.read_text(encoding='utf-8'), str(path))
        self.assertFalse(list((HTML / 'krym').glob('*/generatory/index.html')))

    def test_sitemap_contains_exactly_one_canonical(self):
        urls = [x.text for x in ET.parse(HTML / 'sitemap.xml').iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
        self.assertEqual(1, urls.count('https://kepstroy.ru' + URL))


if __name__ == '__main__':
    unittest.main()
