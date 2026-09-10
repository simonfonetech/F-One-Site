"""
Static site generator for fonetech.uk.

Reads site.yaml + data/nav.yaml + data/categories.yaml + content/**/*.md,
renders everything through Jinja2 templates, and writes pretty-URL HTML
into output/. Also copies static assets and generates sitemap.xml/robots.txt.

Usage: python build.py
"""
import os
import re
import shutil
import time
import yaml
import markdown as md
from datetime import date
from jinja2 import Environment, FileSystemLoader

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CONTENT_DIR = os.path.join(ROOT, 'content')
TEMPLATES_DIR = os.path.join(ROOT, 'templates')
STATIC_DIR = os.path.join(ROOT, 'static')
ASSETS_DIR = os.path.join(ROOT, 'assets')
DATA_DIR = os.path.join(ROOT, 'data')
OUTPUT_DIR = os.path.join(ROOT, 'output')

POSTS_PER_PAGE = 9

# Per-service accent colour for the header banner (phone number, "Get in
# touch" button) and the floating socials rail, keyed by page slug. Matches
# the colours already used for each service in the mega-menu's icon_map.
# Every other page has no entry, so page_theme_color is None and the
# banner/socials fall back to their normal site-wide orange.
SERVICE_ACCENTS = {
    'cloud-phone-systems':   'var(--blue)',
    'internet-connectivity': 'var(--primary)',
    'wifi-and-networking':   'var(--yellow)',
    'mobile-sim-plans':      'var(--green)',
    'it-essentials':         'var(--purple)',
    'elevate':               'var(--blue)',
    'insights':              'var(--blue)',
    'live-view':             'var(--blue)',
    'voice-studio':          'var(--blue)',
}
# Individual product pages linked from one of the 5 service pages above
# (each carrying its own accordion, e.g. "SmartVoice Messaging" on
# /cloud-phone-systems/) inherit that service's colour too, via the same
# page_theme_color mechanism -- confirmed by scanning each service page's
# own content for hrefs into these slugs. The four yealink-t44w/t54w/t57w/
# t58w-pro pages aren't currently linked from the cloud-phone-systems
# carousel but are the same desk-phone family as the ones that are, so
# they're grouped the same way. customerarea is excluded -- it's the
# customer login portal, not a themed product.
#
# routers/wifi-access-points/managed-switches/comms-cabinets are linked
# from the Cloud Phone Systems page's content but are networking
# hardware, not phone hardware -- grouped under WiFi & Networking
# instead, per explicit correction.
_CLOUD_PHONE_SYSTEMS_PRODUCTS = [
    'archiving', 'ai-call-recap', 'sentiment-and-topic-analysis',
    'mobile-and-softphone-apps', 'call-queues-and-hunt-groups', 'microsoft-teams',
    'cisco-6825', 'cisco-9851', 'cisco-9861', 'cisco-9871',
    'cordless-dect', 'crm-integration',
    'smartvoice-on-hold-messaging',
    'yealink-t34w', 'yealink-t44w', 'yealink-t54w', 'yealink-t57w',
    'yealink-t58w-pro', 'yealink-t73w', 'yealink-t74w', 'yealink-t85w',
    'yealink-t87w', 'yealink-t88wpro', 'yealink-w56h', 'yealink-w59rpro',
    'yealink-w73h', 'yealink-wh64',
]
_IT_ESSENTIALS_PRODUCTS = [
    'backup-for-microsoft365', 'cyber-essentials-support', 'email-security',
    'endpoint-detection-response', 'microsoft365-licence-management', 'rmm',
    'security-awareness-training', 'uniqkey-password-manager',
]
_WIFI_AND_NETWORKING_PRODUCTS = [
    'omada-network-management', 'social-wifi',
    'routers', 'wifi-access-points', 'managed-switches', 'comms-cabinets',
]
_INTERNET_CONNECTIVITY_PRODUCTS = ['satellite-broadband']
for _slug in _CLOUD_PHONE_SYSTEMS_PRODUCTS:
    SERVICE_ACCENTS[_slug] = SERVICE_ACCENTS['cloud-phone-systems']
for _slug in _IT_ESSENTIALS_PRODUCTS:
    SERVICE_ACCENTS[_slug] = SERVICE_ACCENTS['it-essentials']
for _slug in _WIFI_AND_NETWORKING_PRODUCTS:
    SERVICE_ACCENTS[_slug] = SERVICE_ACCENTS['wifi-and-networking']
for _slug in _INTERNET_CONNECTIVITY_PRODUCTS:
    SERVICE_ACCENTS[_slug] = SERVICE_ACCENTS['internet-connectivity']
# Product pages branded after the product itself rather than the parent
# service (user, 2026-09-03): the header banner (phone number, "Get in
# touch") and the floating socials rail take the product's own colour.
# Applied last so it wins over the service grouping above (microsoft-teams
# is otherwise a Cloud Phone Systems product and would be blue).
BRAND_ACCENTS = {
    'whatsapp-for-business': 'var(--wp--preset--color--wsa-green, #2ACC63)',  # WhatsApp green (site preset)
    'microsoft-teams':       '#5B5FC7',                                         # Microsoft Teams purple
}
SERVICE_ACCENTS.update(BRAND_ACCENTS)

FRONTMATTER_RE = re.compile(r'\A---\n(.*?)\n---\n?', re.DOTALL)


def load_yaml(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, encoding='utf-8') as f:
        return yaml.safe_load(f) or default


def read_markdown_file(path):
    with open(path, encoding='utf-8') as f:
        raw = f.read()
    m = FRONTMATTER_RE.match(raw)
    if not m:
        return {}, raw
    frontmatter = yaml.safe_load(m.group(1)) or {}
    body = raw[m.end():]
    return frontmatter, body


def render_body(fields, body):
    if fields.get('format') == 'markdown':
        return md.markdown(body, extensions=['extra'])
    return body


def load_content(subdir):
    out = []
    d = os.path.join(CONTENT_DIR, subdir)
    if not os.path.isdir(d):
        return out
    for fname in sorted(os.listdir(d)):
        if not fname.endswith('.md'):
            continue
        fields, body = read_markdown_file(os.path.join(d, fname))
        fields['_body'] = render_body(fields, body)
        out.append(fields)
    return out


def generated_css_path(post_id):
    if not post_id:
        return None
    src = os.path.join(STATIC_DIR, 'css', 'generated', f'{post_id}.css')
    if os.path.isfile(src):
        return f'/static/css/generated/{post_id}.css'
    return None


def write_file(rel_path, content):
    dest = os.path.join(OUTPUT_DIR, rel_path.lstrip('/'))
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, 'w', encoding='utf-8') as f:
        f.write(content)


def main():
    if os.path.exists(OUTPUT_DIR):
        shutil.rmtree(OUTPUT_DIR)
    os.makedirs(OUTPUT_DIR)

    site = load_yaml(os.path.join(ROOT, 'site.yaml'), {})
    nav = load_yaml(os.path.join(DATA_DIR, 'nav.yaml'), {'header': [], 'footer': []})
    categories = load_yaml(os.path.join(DATA_DIR, 'categories.yaml'), [])

    env = Environment(loader=FileSystemLoader(TEMPLATES_DIR), autoescape=False)
    build_year = date.today().year
    # Cache-buster for local css/js. Without it a browser keeps serving the
    # stylesheet it already has and a rebuild looks like it did nothing.
    asset_version = str(int(time.time()))

    def base_ctx(**extra):
        ctx = {'site': site, 'nav': nav, 'build_year': build_year,
               'asset_version': asset_version}
        ctx.update(extra)
        return ctx

    urls = []

    # ---------------- posts (loaded first so pages can embed the newest) ----------------
    posts_raw = load_content('posts')
    posts_raw.sort(key=lambda p: p.get('date') or '', reverse=True)

    posts_view = []
    for p in posts_raw:
        url = f"/{p['slug']}/"
        posts_view.append({
            'title': p.get('title', ''),
            'url': url,
            'date': p.get('date', ''),
            'categories': p.get('categories') or [],
            'featured_image': p.get('featured_image'),
            'excerpt': p.get('excerpt', ''),
        })

    # A page body may carry the marker below (About Us: "Read Our Latest
    # Blog"); it's replaced with the newest post at build time, so the
    # section keeps itself current as posts are added.
    LATEST_POST_MARKER = '<!-- latest-post -->'
    latest_post_html = (env.get_template('partials/latest_post.html').render(base_ctx(post=posts_view[0]))
                        if posts_view else '')

    # ---------------- pages ----------------
    pages = load_content('pages')
    for p in pages:
        slug = p['slug']
        path = f'/{slug}/'
        html = env.get_template('page.html').render(base_ctx(
            page_title=p.get('title', ''),
            page_description=p.get('excerpt', '') or '',
            canonical_path=path,
            og_image=p.get('featured_image'),
            content=p['_body'].replace(LATEST_POST_MARKER, latest_post_html),
            generated_css=generated_css_path(p.get('post_id')),
            page_theme_color=SERVICE_ACCENTS.get(slug),
            is_homepage=(slug == site.get('homepage_slug')),
            page_slug=slug,  # body.page-<slug>, for per-page CSS scoping
        ))
        write_file(path + 'index.html', html)
        urls.append(path)
        if slug == site.get('homepage_slug'):
            write_file('/index.html', html)
            urls.append('/')

    # ---------------- posts ----------------
    # (posts_raw / posts_view are built above, before the pages loop)
    for p, view in zip(posts_raw, posts_view):
        html = env.get_template('post.html').render(base_ctx(
            page_title=p.get('title', ''),
            page_description=p.get('excerpt', '') or '',
            canonical_path=view['url'],
            og_image=p.get('featured_image'),
            post=view,
            content=p['_body'],
            generated_css=generated_css_path(p.get('post_id')),
        ))
        write_file(view['url'] + 'index.html', html)
        urls.append(view['url'])

    # ---------------- blog index (paginated) ----------------
    def paginate(post_list, base_path):
        total_pages = max(1, (len(post_list) + POSTS_PER_PAGE - 1) // POSTS_PER_PAGE)
        for page_num in range(1, total_pages + 1):
            chunk = post_list[(page_num - 1) * POSTS_PER_PAGE: page_num * POSTS_PER_PAGE]
            out_path = base_path if page_num == 1 else f'{base_path}page/{page_num}/'
            yield page_num, total_pages, chunk, out_path

    def pagination_url_factory(base_path):
        return lambda n: base_path if n == 1 else f'{base_path}page/{n}/'

    for page_num, total_pages, chunk, out_path in paginate(posts_view, '/blog/'):
        html = env.get_template('blog_index.html').render(base_ctx(
            page_title='Blog',
            page_description=site.get('description', ''),
            canonical_path=out_path,
            og_image=None,
            posts=chunk,
            categories=categories,
            active_category=None,
            current_page=page_num,
            total_pages=total_pages,
            pagination_url=pagination_url_factory('/blog/'),
        ))
        write_file(out_path + 'index.html', html)
        urls.append(out_path)

    # ---------------- blog category pages (paginated) ----------------
    for cat in categories:
        matching = [p for p in posts_view if cat['name'] in p['categories']]
        base_path = f"/blog/category/{cat['slug']}/"
        for page_num, total_pages, chunk, out_path in paginate(matching, base_path):
            html = env.get_template('blog_index.html').render(base_ctx(
                page_title=f"{cat['name']} - Blog",
                page_description=site.get('description', ''),
                canonical_path=out_path,
                og_image=None,
                posts=chunk,
                categories=categories,
                active_category=cat['slug'],
                current_page=page_num,
                total_pages=total_pages,
                pagination_url=pagination_url_factory(base_path),
            ))
            write_file(out_path + 'index.html', html)
            urls.append(out_path)

    # ---------------- static assets ----------------
    shutil.copytree(STATIC_DIR, os.path.join(OUTPUT_DIR, 'static'), dirs_exist_ok=True)
    # everything under assets/ ships as-is: uploads/ plus theme/ (images the
    # live theme serves from wp-content/themes/f-one/images)
    if os.path.isdir(ASSETS_DIR):
        shutil.copytree(ASSETS_DIR, os.path.join(OUTPUT_DIR, 'assets'), dirs_exist_ok=True)

    # ---------------- sitemap + robots ----------------
    base_url = site.get('base_url', '').rstrip('/')
    sitemap_entries = ''.join(f'  <url><loc>{base_url}{u}</loc></url>\n' for u in sorted(set(urls)))
    sitemap = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f'{sitemap_entries}'
        '</urlset>\n'
    )
    write_file('/sitemap.xml', sitemap)
    write_file('/robots.txt', f'User-agent: *\nAllow: /\nSitemap: {base_url}/sitemap.xml\n')

    # ---------------- redirects ----------------
    # Cloudflare Pages reads _redirects from the output root. The retired
    # pages also keep a stub .md that bounces via JS for the local preview.
    redirects = {
        '/smartvoice-on-hold-messaging/': '/voice-studio/',
        '/insights/': '/ai-call-recap/',
    }
    write_file('/_redirects', ''.join(f'{src} {dst} 301\n' for src, dst in redirects.items()))

    print(f'Built {len(pages)} pages, {len(posts_raw)} posts, {len(categories)} category listings.')
    print(f'Output written to {OUTPUT_DIR}')


if __name__ == '__main__':
    main()
