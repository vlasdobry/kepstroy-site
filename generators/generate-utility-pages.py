"""Two central utility connection pages; source facts confirmed on 2026-11-09."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / 'html'


def choices(name, title, values):
    opts = ''.join(f'<label class="utility-option"><input type="radio" name="{name}" value="{v}" required><span>{t}</span></label>' for v, t in values)
    return f'<fieldset><legend>{title}</legend><div class="utility-options">{opts}</div></fieldset>'


def selector(service):
    route = '<p class="utility-route">Нужна автономная канализация? <a href="/uslugi/septiki/" data-utility-route="septiki">Посмотреть септики</a></p>' if service == 'sewer' else ''
    steps = [
        choices('object', 'Для какого объекта нужно подключение?', [('home', 'Частный дом или участок'), ('commercial', 'Крупный коммерческий объект'), ('other', 'Другой объект')]) + choices('location', 'Где находится объект?', [('simferopol', 'В Симферополе'), ('outside', 'В другом населённом пункте Крыма')]),
        choices('connection', 'Что известно о точке подключения?', [('known', 'Точка подключения известна'), ('nearby', 'Сеть рядом, точку нужно уточнить'), ('unknown', 'Пока не знаю')]) + choices('documents', 'Есть технические условия или проект?', [('ready', 'Есть'), ('progress', 'В процессе оформления'), ('none', 'Пока нет'), ('unknown', 'Не знаю')]),
        choices('length', 'Какой может быть длина трассы?', [('short', 'До 10 м'), ('medium', '10–30 м'), ('long', 'Более 30 м'), ('unknown', 'Не знаю')]) + choices('surface', 'Что находится на пути трассы?', [('soil', 'Грунт'), ('paved', 'Плитка, асфальт или дорога'), ('mixed', 'Разные покрытия'), ('unknown', 'Нужно посмотреть')]),
    ]
    panes = ''.join(f'<div data-utility-step="{i}" hidden>{content}</div>' for i, content in enumerate(steps))
    return f'''<section class="utility-section utility-tint" id="podbor">
      <div class="container utility-selector" data-utility-selector="{service}">
        <div class="utility-heading"><h2>Подберите состав работ для вашего объекта</h2><p>Три коротких шага. Покажем, что уточнить для сметы. Результат доступен без номера телефона.</p></div>
        <button class="btn btn--primary" type="button" data-utility-start>Подобрать работы</button>
        <div data-utility-questions hidden><p class="utility-progress" data-utility-progress tabindex="-1" aria-live="polite">Шаг 1 из 3</p>
          {panes}<p class="utility-error" data-utility-validation role="alert" hidden>Выберите ответ на каждый вопрос. Если данных нет, выберите «Не знаю».</p>
          <div class="utility-actions"><button type="button" class="btn btn--outline" data-utility-back>Назад</button><button type="button" class="btn btn--primary" data-utility-next>Далее</button></div>
        </div>
        <div class="utility-result" data-utility-result tabindex="-1" hidden><h3>Ваш запрос</h3><p data-utility-summary></p><p data-utility-next-step></p>
          <p>Трассу определяем на осмотре. Стоимость подключения рассчитываем индивидуально после выезда. Выезд стоит 5 000 ₽, сумма засчитывается при заключении договора.</p>
          <div class="utility-actions"><a class="btn btn--primary" href="#zayavka">Обсудить со специалистом</a><button class="btn btn--outline" type="button" data-utility-edit>Изменить ответы</button></div>
        </div>
        {route}<noscript><p>Для подбора нужен JavaScript. Можно сразу оставить заявку ниже или позвонить: <a href="tel:+79784615962">+7 (978) 461-59-62</a>.</p></noscript>
      </div></section>'''


def build(slug, service, hero, detail):
    target = HTML / 'uslugi' / slug / 'index.html'
    source = target.read_text(encoding='utf-8')
    # Preserve the site's navigation, legal links, footer and telephone contract.
    marker = '<main class="utility-page"' if '<main class="utility-page"' in source else '  <section class="hero'
    lead = source[:source.index(marker)]
    tail = source[source.index('  <footer'):]
    tail = re.sub(r'<button class="sticky-phone__btn js-smart-call"[^>]*>(.*?)</button>', r'<a class="sticky-phone__btn" href="tel:+79784615962" aria-label="Позвонить">\1</a>', tail, flags=re.S)
    tail = re.sub(r'\s*<script src="/js/utility-selector.js[^\"]*"></script>', '', tail)
    h1 = 'Подключение к центральному водопроводу' if service == 'water' else 'Подключение к центральной канализации'
    title = h1 + ' в Крыму | КэпСтрой'
    description = h1 + ' в Крыму: наружные сети, документация, индивидуальная смета после осмотра. Выезд 5 000 ₽ с зачётом при заключении договора.'
    lead = re.sub(r'<title>.*?</title>', f'<title>{title}</title>', lead)
    lead = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{description}">', lead)
    lead = re.sub(r'\s*<link rel="stylesheet" href="/css/utility.css[^\"]*">', '', lead)
    lead = lead.replace('</head>', '<link rel="stylesheet" href="/css/utility.css?v=1">\n</head>')
    def schema(match):
        data = json.loads(match.group(1))
        if data.get('@type') == 'Service':
            data['serviceType'] = h1
            data['description'] = description
            data['areaServed'] = 'Республика Крым'
            data.pop('priceRange', None)
        return '<script type="application/ld+json">\n' + json.dumps(data, ensure_ascii=False, indent=2) + '\n</script>'
    lead = re.sub(r'<script type="application/ld\+json">\s*(.*?)\s*</script>', schema, lead, flags=re.S)
    other = 'kanalizaciya' if service == 'water' else 'vodosnabzhenie'
    other_text = 'Подключение канализации' if service == 'water' else 'Подключение водопровода'
    article = '/blog/vodosnabzhenie-chastnogo-doma-krym/' if service == 'water' else '/blog/kanalizaciya-v-chastnom-dome-krym/'
    photo_alt = 'Счётчик воды и запорный кран в колодце' if service == 'water' else 'Бетонный колодец с подводом трубы'
    detail_alt = 'Запорные задвижки на водопроводных трубах' if service == 'water' else 'Узел труб в бетонном колодце'
    exclusion = 'Бурение скважин, аварийную прочистку, мелкую сантехнику и мелкий ремонт не выполняем.'
    main = f'''<main class="utility-page" data-utility-service="{service}">
    <section class="utility-hero"><div class="container utility-hero-grid">
      <div><p class="utility-eyebrow">Наружные сети · Крым</p><h1>{h1}</h1>
        <p class="utility-lead">Прокладываем наружные сети до ввода на участок. Берём на себя документацию и организацию работ под ключ.</p>
        <div class="utility-actions"><a href="#podbor" class="btn btn--primary" data-utility-open>Подобрать работы</a><a href="tel:+79784615962" class="btn btn--outline">Позвонить</a></div>
      </div>
      <img src="/images/works/{slug}/{hero}" alt="{photo_alt}" width="900" height="1200" fetchpriority="high" class="utility-hero-photo">
    </div></section>

    <section class="utility-section"><div class="container utility-scope">
      <div class="utility-heading"><h2>От ближайшей сети до вашего участка</h2><p>Состав наружных работ определяем по условиям объекта. Подключение к центральной сети организуем вместе с водоканалом.</p></div>
      <dl class="utility-scope-list"><div><dt>Наружные сети</dt><dd>Трасса водопровода или канализации, максимум ввод на участок. Внутреннюю разводку для крупного коммерческого объекта обсуждаем отдельно.</dd></div>
      <div><dt>Документация</dt><dd>Документами занимается КэпСтрой. Фактическую врезку в центральную сеть выполняет водоканал.</dd></div>
      <div><dt>Границы услуги</dt><dd>{exclusion}</dd></div></dl>
    </div></section>
    {selector(service)}
    <section class="utility-section" id="stoimost"><div class="container utility-estimate">
      <div class="utility-heading"><h2>Сначала осмотр, затем смета</h2><p>Стоимость зависит от трассы, точки подключения, покрытия и условий объекта. Заочная цена за метр не заменяет осмотр.</p></div>
      <div class="utility-visit"><strong>5 000 ₽</strong><span>Выезд для определения трассы</span><p>При заключении договора эта сумма засчитывается. Выезд нужен в любом случае, даже если точка подключения известна.</p></div>
      <ol class="utility-process"><li><h3>Обсуждаем задачу</h3><p>Для начала нужен адрес объекта. Если он вне Симферополя, предварительно понадобится видео предполагаемой трассы и ближайшего колодца.</p></li><li><h3>Осматриваем объект</h3><p>Уточняем маршрут водопровода или канализации и условия прокладки на месте.</p></li><li><h3>Составляем индивидуальный расчёт</h3><p>После осмотра определяем состав и стоимость работ для вашего объекта.</p></li></ol>
    </div></section>
    <section class="utility-section utility-tint"><div class="container utility-work">
      <figure><img src="/images/works/{slug}/{detail}" alt="{detail_alt}" width="900" height="1200" loading="lazy"><figcaption>{detail_alt}. Фото из работ КэпСтрой.</figcaption></figure>
      <div class="utility-heading"><h2>Условия на месте определяют решение</h2><p>По фото виден отдельный этап работ. Точку подключения, маршрут и состав вашего заказа уточним на осмотре.</p><p>Посмотрите другие фотографии в <a href="/portfolio/">нашем портфолио</a>.</p></div>
    </div></section>
    <section class="utility-section"><div class="container utility-faq"><h2>Перед первым обращением</h2>
      <details><summary>Что подготовить для разговора?</summary><p>Адрес объекта. Для объекта за пределами Симферополя предварительно подготовьте видео: как вы видите прокладку сети к участку и где находится ближайший колодец. Передать его можно после связи со специалистом.</p></details>
      <details><summary>Можно обойтись без выезда?</summary><p>Выезд нужен в любом случае, чтобы определить трассу. Индивидуальный расчёт составляем после осмотра.</p></details>
      <details><summary>Кто оформляет документы и делает врезку?</summary><p>Документацией занимается КэпСтрой. Врезку в центральный водопровод или канализацию выполняет водоканал.</p></details>
      <details><summary>Делаете разводку внутри здания?</summary><p>Основная услуга включает наружные сети, максимум ввод на участок. Внутреннюю разводку можем отдельно обсудить для крупного коммерческого объекта.</p></details>
      <details><summary>Какие небольшие работы вы берёте?</summary><p>{exclusion}</p></details>
      <p class="utility-related"><a href="/uslugi/{other}/">{other_text}</a><a href="/uslugi/septiki/">Автономная канализация: септики</a><a href="{article}">Как выбрать решение для дома</a></p>
    </div></section>
    <section class="utility-section utility-tint" id="zayavka"><div class="container utility-contact">
      <div class="utility-heading"><h2>Обсудим подключение вашего объекта</h2><p>Оставьте телефон. Свяжемся, уточним адрес и исходные данные для сметы. Подбор проходить необязательно.</p><a href="tel:+79784615962" class="utility-phone">+7 (978) 461-59-62</a></div>
      <form id="utility-form" action="/submit" method="POST" data-utility-service="{service}">
        <input type="hidden" name="form_source" value="kepstroy"><input type="hidden" name="service" value="{h1}"><input type="hidden" name="message" value="Запрос на подключение к центральной сети. Подбор не пройден.">
        <div class="form-honeypot" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"><input type="text" name="company" tabindex="-1" autocomplete="off"></div>
        <label for="utility-phone">Ваш телефон</label><input class="input" id="utility-phone" type="tel" name="phone" autocomplete="tel" placeholder="+7 (___) ___-__-__" required>
        <div class="form-consent"><label><input type="checkbox" name="consent" required><span>Согласен на обработку <a href="/politika-konfidencialnosti/">персональных данных</a></span></label></div>
        <p data-utility-error class="utility-error" role="alert" hidden></p><button type="submit" class="btn btn--primary">Обсудить подключение</button>
        <p class="utility-form-note">Заявка на связь со специалистом. Условия выезда обсудим до его назначения.</p>
      </form>
    </div></section></main>
'''
    result = lead + main + tail.replace('</body>', '  <script src="/js/utility-selector.js?v=1"></script>\n</body>')
    target.write_text(result, encoding='utf-8', newline='\n')


build('vodosnabzhenie', 'water', 'IMG_1130.jpg', '2CB88526-8E8C-4EB0-94D4-54843C418591.jpg')
build('kanalizaciya', 'sewer', 'IMG_0031.jpg', 'IMG_0451.jpg')
print('Generated 2 central utility connection pages')
