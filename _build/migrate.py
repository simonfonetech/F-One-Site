"""
WordPress -> static site importer for fonetech.uk.

Reads the WXR export, pulls out published pages/posts and the site's nav
menus, runs GenerateBlocks content through gbrender.py to reconstruct real
HTML/CSS, rewrites media/internal links, downloads referenced media from the
live site (no local uploads folder was available), and writes everything out
as Markdown files with YAML frontmatter under content/.

Usage: python migrate.py
"""
import sys
import os
import re
import json
import html as htmllib
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

sys.path.insert(0, os.path.dirname(__file__))
import gbrender

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
WXR_PATH = os.path.join(ROOT, 'fonetechnologiesltd.WordPress.2026-08-25.xml')
CONTENT_DIR = os.path.join(ROOT, 'content')
DATA_DIR = os.path.join(ROOT, 'data')
ASSETS_DIR = os.path.join(ROOT, 'assets', 'uploads')
STATIC_CSS_DIR = os.path.join(ROOT, 'static', 'css')
LIVE_BASE = 'https://fonetech.uk'

NS = {
    'wp': 'http://wordpress.org/export/1.2/',
    'content': 'http://purl.org/rss/1.0/modules/content/',
    'excerpt': 'http://wordpress.org/export/1.2/excerpt/',
}

MEDIA_DOMAINS = ('fonetech.uk', 'fone.purenetdesign.com')
SKIP_PAGE_SLUGS = {'blog'}  # blog index is generated, not migrated as a flat page

# Field sets mirror the live Contact Form 7 forms: the general enquiry form is
# name / email / message, the quote form is service / user count / name / phone /
# email. A static build has nowhere to post to, so both carry a note.
CONTACT_FORM_HTML = """
<div class="wp-contact-form-wrap">
  <form class="wp-contact-form" action="#" method="post" onsubmit="return false;">
    <div><label for="cf-name-{cid}">Name</label><input type="text" id="cf-name-{cid}" name="your-name" placeholder="Name" required></div>
    <div><label for="cf-email-{cid}">Email</label><input type="email" id="cf-email-{cid}" name="your-email" placeholder="Email" required></div>
    <div><label for="cf-message-{cid}">Message</label><textarea id="cf-message-{cid}" name="your-message" placeholder="Message" rows="5"></textarea></div>
    <button type="submit" class="gb-button">Submit</button>
  </form>
  <p class="form-note">This form needs a submission endpoint connecting before it will send.</p>
</div>
""".strip()

QUOTE_FORM_HTML = """
<div class="wp-contact-form-wrap request-quote-form">
  <form class="wp-contact-form" action="#" method="post" onsubmit="return false;">
    <div><label for="cf-service-{cid}">Product or service</label><select id="cf-service-{cid}" name="your-services">
      <option value="">Please choose an option</option>
      <option>Cloud Phone Systems</option>
      <option>Internet Connectivity</option>
      <option>WiFi &amp; Networking</option>
      <option>Mobile SIM Plans</option>
      <option>IT Essentials</option>
    </select></div>
    <div><label for="cf-users-{cid}">Estimated number of users</label><input type="range" id="cf-users-{cid}" name="your-users" min="1" max="250" value="10" oninput="this.nextElementSibling.value=this.value"><output>10</output></div>
    <div><label for="cf-name-{cid}">Name</label><input type="text" id="cf-name-{cid}" name="your-name" placeholder="Name" required></div>
    <div><label for="cf-phone-{cid}">Phone</label><input type="tel" id="cf-phone-{cid}" name="your-phone" placeholder="Phone"></div>
    <div><label for="cf-email-{cid}">Email</label><input type="email" id="cf-email-{cid}" name="your-email" placeholder="Email" required></div>
    <button type="submit" class="gb-button">Submit</button>
  </form>
  <p class="form-note">This form needs a submission endpoint connecting before it will send.</p>
</div>
""".strip()

DYNAMIC_NOTICE_HTML = (
    '<div class="dynamic-notice">This section lists live content managed on the '
    'WordPress site and is not included in this static export.</div>'
)


# ---------------------------------------------------------------- WXR loading

def load_items():
    tree = ET.parse(WXR_PATH)
    channel = tree.getroot().find('channel')
    return channel.findall('item'), channel


def meta_dict(item):
    out = {}
    for pm in item.findall('wp:postmeta', namespaces=NS):
        k = pm.findtext('wp:meta_key', namespaces=NS)
        v = pm.findtext('wp:meta_value', namespaces=NS)
        out[k] = v
    return out


def build_attachment_map(items):
    m = {}
    for it in items:
        if it.findtext('wp:post_type', namespaces=NS) == 'attachment':
            pid = it.findtext('wp:post_id', namespaces=NS)
            url = it.findtext('wp:attachment_url', namespaces=NS) or it.findtext('guid')
            m[pid] = url
    return m


def build_award_items(items, attachment_map, media_set):
    """The 'award' CPT (ACF repeater fields) that backs the awards-and-achievements
    page's GenerateBlocks query loop. Not a generic loop resolver -- targeted at
    this one page's known template structure."""
    out = []
    for it in items:
        if it.findtext('wp:post_type', namespaces=NS) != 'award':
            continue
        if it.findtext('wp:status', namespaces=NS) != 'publish':
            continue
        meta = meta_dict(it)
        image_url = None
        att_id = meta.get('award_image')
        if att_id and att_id in attachment_map:
            image_url = rewrite_media(attachment_map[att_id], media_set)
        rows = []
        i = 0
        while f'award_{i}_award_title' in meta:
            rows.append({
                'winner_or_shortlisted': meta.get(f'award_{i}_winner_or_shortlisted')
                    or meta.get(f'award_{i}_shortlisted_or_winner') or '',
                'award_title': meta.get(f'award_{i}_award_title') or '',
                'award_description': meta.get(f'award_{i}_award_description') or '',
            })
            i += 1
        out.append({
            'date': it.findtext('wp:post_date', namespaces=NS) or '',
            'image': image_url,
            'rows': rows,
        })
    out.sort(key=lambda a: a['date'], reverse=True)
    return out


AWARD_OUTER_RE = re.compile(
    r'<div class="gb-query-523cef65">\s*<div class="gb-looper-9772cf59">\s*'
    r'<div class="gb-loop-item award-loop-item">(?P<tpl>.*?)'
    r'<div class="gb-element-743e465d award-splitter"></div>\s*</div>\s*</div>\s*</div>',
    re.DOTALL,
)
AWARD_INNER_RE = re.compile(
    r'<div class="gb-looper-946f9c85">\s*<div class="gb-loop-item gb-loop-item-a8db4ecb">'
    r'(?P<tpl>.*?)</div>\s*</div>',
    re.DOTALL,
)


def resolve_award_loop(body, award_items):
    m = AWARD_OUTER_RE.search(body)
    if not m or not award_items:
        return body
    outer_tpl = m.group('tpl')

    inner_m = AWARD_INNER_RE.search(outer_tpl)
    inner_tpl = inner_m.group('tpl') if inner_m else ''

    rendered_awards = []
    for award in award_items:
        rows_html = ''
        for row in award['rows']:
            row_html = inner_tpl
            for key in ('winner_or_shortlisted', 'award_title', 'award_description'):
                row_html = row_html.replace('{{loop_item key:' + key + '}}', htmllib.escape(row[key]))
            rows_html += row_html
        one = outer_tpl
        if inner_m:
            one = one[:inner_m.start()] + rows_html + one[inner_m.end():]
        one = one.replace('{{post_meta key:award_image}}', award['image'] or '')
        rendered_awards.append(one)

    return body[:m.start()] + ''.join(rendered_awards) + body[m.end():]


def build_block_map(items):
    m = {}
    for it in items:
        if it.findtext('wp:post_type', namespaces=NS) == 'wp_block':
            pid = it.findtext('wp:post_id', namespaces=NS)
            m[pid] = it.findtext('content:encoded', namespaces=NS) or ''
    return m


# ------------------------------------------------------------- text pipeline

REF_RE = re.compile(r'<!--\s*wp:block\s*(\{[^}]*\})\s*/-->')


def expand_refs(content, block_map, depth=0):
    if depth > 5:
        return content

    def sub(m):
        try:
            ref = json.loads(m.group(1)).get('ref')
        except json.JSONDecodeError:
            return ''
        return block_map.get(str(ref), '')

    new_content, n = REF_RE.subn(sub, content)
    if n and depth < 5:
        return expand_refs(new_content, block_map, depth + 1)
    return new_content


EMBED_RE = re.compile(
    r'<figure class="wp-block-embed[^"]*"><div class="wp-block-embed__wrapper">\s*'
    r'(https?://\S+?)\s*</div></figure>',
    re.DOTALL,
)
YOUTUBE_RE = re.compile(r'(?:youtu\.be/|watch\?v=)([\w-]{6,})')


def convert_embeds(content):
    def sub(m):
        url = m.group(1)
        yt = YOUTUBE_RE.search(url)
        if yt:
            vid = yt.group(1)
            return (
                '<div class="video-embed"><iframe src="https://www.youtube.com/embed/'
                f'{vid}" title="Video" loading="lazy" allowfullscreen></iframe></div>'
            )
        return f'<p><a href="{url}">{url}</a></p>'
    return EMBED_RE.sub(sub, content)


# Contact Form 7 ids are not always numeric -- newer forms use a hash such as
# id="ad4dec2". The old \d+ pattern matched neither of the ids on the contact
# page, so both shortcodes were left in the output as literal text.
CF7_RE = re.compile(r'\[contact-form-7\s+id="([\w-]+)"([^\]]*)\]')
CF7_TITLE_RE = re.compile(r'title="([^"]*)"')
JOBS_RE = re.compile(r'\[(?:jobs|submit_job_form)[^\]]*\]')


def render_cf7(match):
    """Build the form that matches the one this shortcode stands in for."""
    cid = match.group(1)
    title_match = CF7_TITLE_RE.search(match.group(2) or '')
    title = (title_match.group(1) if title_match else '').lower()
    if 'quote' in title:
        return QUOTE_FORM_HTML.format(cid=cid)
    return CONTACT_FORM_HTML.format(cid=cid)


def convert_shortcodes(content):
    content = CF7_RE.sub(render_cf7, content)
    content = JOBS_RE.sub(DYNAMIC_NOTICE_HTML, content)
    return content


MEDIA_RE = re.compile(
    r'https?://(?:' + '|'.join(re.escape(d) for d in MEDIA_DOMAINS) + r')(/wp-content/uploads/[^\s"\'\)]+)'
)
INTERNAL_LINK_RE = re.compile(r'https?://fonetech\.uk(/[^\s"\'\)]*)')


def rewrite_media(html_text, media_set):
    def sub(m):
        path = m.group(1)
        rel = path.split('/wp-content/uploads/', 1)[1]
        media_set.add((m.group(0), rel))
        return '/assets/uploads/' + rel
    return MEDIA_RE.sub(sub, html_text)


def rewrite_internal_links(html_text):
    return INTERNAL_LINK_RE.sub(lambda m: m.group(1) or '/', html_text)


TAG_RE = re.compile(r'<[^>]+>')
STYLE_BLOCK_RE = re.compile(r'<style>.*?</style>', re.DOTALL)


def make_excerpt(html_text, length=160):
    text = STYLE_BLOCK_RE.sub(' ', html_text)
    text = TAG_RE.sub(' ', text)
    text = htmllib.unescape(re.sub(r'\s+', ' ', text)).strip()
    if len(text) <= length:
        return text
    cut = text[:length].rsplit(' ', 1)[0]
    return cut + '...'


def slugify(text):
    text = htmllib.unescape(text or '').lower().replace('&', 'and')
    text = re.sub(r'[^a-z0-9]+', '-', text).strip('-')
    return text or 'item'


# ------------------------------------------------------------------- content

def process_content(raw, block_map, media_set):
    content = expand_refs(raw, block_map)
    content = convert_embeds(content)
    content = convert_shortcodes(content)
    html_out = gbrender.render(content)
    html_out = rewrite_media(html_out, media_set)
    html_out = rewrite_internal_links(html_out)
    return html_out


def frontmatter_block(fields):
    lines = ['---']
    for k, v in fields.items():
        if v is None:
            continue
        if isinstance(v, list):
            if not v:
                continue
            lines.append(f'{k}:')
            for item in v:
                lines.append(f'  - {yaml_scalar(item)}')
        else:
            lines.append(f'{k}: {yaml_scalar(v)}')
    lines.append('---\n')
    return '\n'.join(lines)


def yaml_scalar(v):
    s = str(v)
    if re.search(r'[:#{}\[\],&*!|>\'"%@`]', s) or s != s.strip():
        return json.dumps(s)
    return s


def write_md(path, fields, body):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(frontmatter_block(fields))
        f.write(body)


# ------------------------------------------------------------------- pages/posts

def migrate_pages_posts(items, attachment_map, block_map, media_set, award_items):
    stats = {'pages': 0, 'posts': 0, 'skipped': 0}
    categories = {}
    post_ids = []

    for it in items:
        ptype = it.findtext('wp:post_type', namespaces=NS)
        status = it.findtext('wp:status', namespaces=NS)
        if ptype not in ('page', 'post') or status != 'publish':
            continue

        slug = it.findtext('wp:post_name', namespaces=NS) or slugify(it.findtext('title'))
        title = htmllib.unescape(it.findtext('title') or '')
        date = (it.findtext('wp:post_date', namespaces=NS) or '')[:10]
        raw = it.findtext('content:encoded', namespaces=NS) or ''

        if ptype == 'page' and slug in SKIP_PAGE_SLUGS:
            stats['skipped'] += 1
            continue

        post_ids.append(it.findtext('wp:post_id', namespaces=NS))
        body = process_content(raw, block_map, media_set)
        if slug == 'awards-and-achievements':
            body = resolve_award_loop(body, award_items)

        meta = meta_dict(it)
        thumb_id = meta.get('_thumbnail_id')
        featured_image = None
        if thumb_id and thumb_id in attachment_map:
            url = attachment_map[thumb_id]
            featured_image = rewrite_media(url, media_set)

        excerpt_raw = it.findtext('excerpt:encoded', namespaces=NS) or ''
        excerpt = htmllib.unescape(excerpt_raw).strip() or make_excerpt(body)

        fields = {
            'title': title,
            'slug': slug,
            'type': ptype,
            'format': 'html',
            'date': date,
            'excerpt': excerpt,
            'featured_image': featured_image,
            'post_id': it.findtext('wp:post_id', namespaces=NS),
        }

        if ptype == 'post':
            cats = []
            for c in it.findall('category'):
                if c.get('domain') == 'category':
                    name = htmllib.unescape(c.text or '')
                    cats.append(name)
                    categories.setdefault(slugify(name), name)
            fields['categories'] = cats
            write_md(os.path.join(CONTENT_DIR, 'posts', f'{slug}.md'), fields, body)
            stats['posts'] += 1
        else:
            write_md(os.path.join(CONTENT_DIR, 'pages', f'{slug}.md'), fields, body)
            stats['pages'] += 1

    return stats, categories, post_ids


# ------------------------------------------------------------------------ nav

def build_id_lookup(items):
    return {it.findtext('wp:post_id', namespaces=NS): it for it in items}


def nav_items_for_menu(items, menu_name):
    out = []
    for it in items:
        if it.findtext('wp:post_type', namespaces=NS) != 'nav_menu_item':
            continue
        if it.findtext('wp:status', namespaces=NS) != 'publish':
            continue
        cats = [c.text for c in it.findall('category') if c.get('domain') == 'nav_menu']
        if menu_name not in cats:
            continue
        meta = meta_dict(it)
        order = it.findtext('wp:menu_order', namespaces=NS)
        out.append({
            'id': it.findtext('wp:post_id', namespaces=NS),
            'title': htmllib.unescape(it.findtext('title') or ''),
            'order': int(order) if order else 0,
            'parent': meta.get('_menu_item_menu_item_parent', '0'),
            'obj_type': meta.get('_menu_item_type'),
            'object_id': meta.get('_menu_item_object_id'),
            'url': meta.get('_menu_item_url') or '',
        })
    out.sort(key=lambda m: m['order'])
    return out


def resolve_nav_item(entry, id_lookup, media_set):
    label = entry['title']
    url = entry['url']
    if entry['obj_type'] == 'post_type' and entry['object_id']:
        page = id_lookup.get(entry['object_id'])
        if page is not None:
            if not label:
                label = htmllib.unescape(page.findtext('title') or '')
            page_slug = page.findtext('wp:post_name', namespaces=NS)
            url = f'/{page_slug}/'
    if url.startswith('https://fonetech.uk') or url.startswith('https://fone.purenetdesign.com'):
        if '/wp-content/uploads/' in url:
            url = rewrite_media(url, media_set)
        else:
            url = rewrite_internal_links(url)
    return label, url


def build_nav_tree(items, id_lookup, menu_name, media_set):
    entries = nav_items_for_menu(items, menu_name)
    top = [e for e in entries if e['parent'] == '0']
    tree = []
    for t in top:
        label, url = resolve_nav_item(t, id_lookup, media_set)
        children = []
        for e in entries:
            if e['parent'] == t['id']:
                clabel, curl = resolve_nav_item(e, id_lookup, media_set)
                children.append({'label': clabel, 'url': curl})
        tree.append({'label': label, 'url': url, 'children': children})
    return tree


def build_footer_columns(items, id_lookup, media_set):
    columns = []
    for menu_name, title in (
        ('Footer Services', 'Our Services'),
        ('Footer Industries', 'Industries'),
        ('Footer Products', 'Products'),
        ('Footer About', 'About Us'),
        ('Footer Terms', 'Company'),
    ):
        entries = nav_items_for_menu(items, menu_name)
        links = []
        for e in entries:
            label, url = resolve_nav_item(e, id_lookup, media_set)
            links.append({'label': label, 'url': url})
        columns.append({'title': title, 'links': links})
    return columns


def dump_yaml(obj, indent=0):
    pad = '  ' * indent
    lines = []
    if isinstance(obj, list):
        if not obj:
            lines.append(f'{pad}[]')
        for item in obj:
            if isinstance(item, (dict, list)):
                sub = dump_yaml(item, indent + 1)
                first, *rest = sub.splitlines()
                lines.append(f'{pad}- {first.strip()}')
                lines.extend(rest)
            else:
                lines.append(f'{pad}- {yaml_scalar(item)}')
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, (dict, list)) and v:
                lines.append(f'{pad}{k}:')
                lines.append(dump_yaml(v, indent + 1))
            elif isinstance(v, (dict, list)):
                lines.append(f'{pad}{k}: []')
            else:
                lines.append(f'{pad}{k}: {yaml_scalar(v)}')
    return '\n'.join(lines)


# --------------------------------------------------------------------- assets

def download_media(media_set):
    os.makedirs(ASSETS_DIR, exist_ok=True)
    ok, failed = 0, []

    def fetch(pair):
        src_url, rel = pair
        dest = os.path.join(ASSETS_DIR, rel.replace('/', os.sep))
        if os.path.exists(dest):
            return ('cached', rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        candidates = [src_url]
        if 'fone.purenetdesign.com' in src_url:
            candidates.append(src_url.replace('fone.purenetdesign.com', 'fonetech.uk'))
        last_err = None
        for url in candidates:
            try:
                req = Request(url, headers={'User-Agent': 'Mozilla/5.0 (static-site-migrate)'})
                with urlopen(req, timeout=20) as resp, open(dest, 'wb') as f:
                    f.write(resp.read())
                return ('ok', rel)
            except (URLError, HTTPError) as e:
                last_err = e
        return ('fail', f'{rel} ({last_err})')

    unique = list({rel: (src, rel) for src, rel in media_set}.values())
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(fetch, pair) for pair in unique]
        for fut in as_completed(futures):
            status, info = fut.result()
            if status in ('ok', 'cached'):
                ok += 1
            else:
                failed.append(info)

    return ok, failed, len(unique)


# ------------------------------------------------------------------- real CSS
# GenerateBlocks Pro renders each container/grid block dynamically and caches
# the resulting CSS as a public file per post: .../generateblocks/style-{id}.css
# (plus one style-global.css for shared/global rules). Fetching these directly
# is far more faithful than re-deriving styles from the blocks' JSON attributes.

def fetch_text(url):
    try:
        req = Request(url, headers={'User-Agent': 'Mozilla/5.0 (static-site-migrate)'})
        with urlopen(req, timeout=15) as resp:
            return resp.read().decode('utf-8', errors='replace')
    except (URLError, HTTPError):
        return None


GENERATED_CSS_DIR = os.path.join(STATIC_CSS_DIR, 'generated')


def fetch_generated_css_per_page(post_ids, media_set):
    """Each page's uniqueIds are only unique WITHIN that page -- two different
    pages can (and do) reuse the same short id for unrelated blocks. GenerateBlocks
    itself serves one style-{postID}.css per page for exactly this reason, so we
    keep them separate too rather than concatenating into one global stylesheet
    (which caused cross-page color collisions when tried)."""
    os.makedirs(GENERATED_CSS_DIR, exist_ok=True)

    def fetch_one(pid):
        css = fetch_text(f'{LIVE_BASE}/wp-content/uploads/generateblocks/style-{pid}.css')
        return pid, css

    fetched = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        for pid, css in pool.map(fetch_one, post_ids):
            if css:
                css = rewrite_media(css, media_set)
                css = rewrite_internal_links(css)
                with open(os.path.join(GENERATED_CSS_DIR, f'{pid}.css'), 'w', encoding='utf-8') as f:
                    f.write(css)
                fetched += 1

    return fetched, len(post_ids) - fetched


def fetch_global_css(media_set):
    css = fetch_text(f'{LIVE_BASE}/wp-content/uploads/generateblocks/style-global.css') or ''
    css = rewrite_media(css, media_set)
    css = rewrite_internal_links(css)
    return css


def fetch_theme_css():
    return fetch_text(f'{LIVE_BASE}/wp-content/themes/f-one/style.css') or ''


# ---------------------------------------------------------------------- main

def main():
    print('Loading WXR...')
    items, _channel = load_items()
    id_lookup = build_id_lookup(items)
    attachment_map = build_attachment_map(items)
    block_map = build_block_map(items)
    media_set = set()

    award_items = build_award_items(items, attachment_map, media_set)

    print('Migrating pages and posts...')
    stats, categories, post_ids = migrate_pages_posts(items, attachment_map, block_map, media_set, award_items)
    print(f"  pages: {stats['pages']}  posts: {stats['posts']}  skipped: {stats['skipped']}")

    print('Building navigation from WXR nav menus...')
    header = build_nav_tree(items, id_lookup, 'Menu 1', media_set)
    footer = build_footer_columns(items, id_lookup, media_set)
    nav = {'header': header, 'footer': footer}
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(os.path.join(DATA_DIR, 'nav.yaml'), 'w', encoding='utf-8') as f:
        f.write(dump_yaml(nav))
    with open(os.path.join(DATA_DIR, 'categories.yaml'), 'w', encoding='utf-8') as f:
        f.write(dump_yaml([{'slug': k, 'name': v} for k, v in sorted(categories.items())]))
    print(f'  header items: {len(header)}  footer columns: {len(footer)}  categories: {len(categories)}')

    print('Fetching GenerateBlocks\' real generated CSS from the live site (one file per page/post)...')
    os.makedirs(STATIC_CSS_DIR, exist_ok=True)
    fetched, missing = fetch_generated_css_per_page(post_ids, media_set)
    global_css = fetch_global_css(media_set)
    with open(os.path.join(STATIC_CSS_DIR, 'generateblocks-global.css'), 'w', encoding='utf-8') as f:
        f.write(global_css)
    theme_css = fetch_theme_css()
    with open(os.path.join(STATIC_CSS_DIR, 'theme.css'), 'w', encoding='utf-8') as f:
        f.write(theme_css)
    print(f'  fetched {fetched} per-page stylesheets ({missing} pages have none -- expected, simple pages don\'t need one)')

    print(f'Downloading {len(media_set)} referenced media files from fonetech.uk...')
    ok, failed, total = download_media(media_set)
    print(f'  {ok}/{total} downloaded successfully')
    if failed:
        print(f'  {len(failed)} FAILED:')
        for f_ in failed[:25]:
            print('   -', f_)
        if len(failed) > 25:
            print(f'   ... and {len(failed) - 25} more')

    print('Done.')


if __name__ == '__main__':
    main()
