"""
Link checker for the built site.

Walks every generated HTML file in output/, extracts href/src attributes,
and verifies:
  - internal links/assets resolve to a real file in output/
  - external links return a non-error HTTP status (best-effort, short timeout)

Usage: python linkcheck.py
"""
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUTPUT_DIR = os.path.join(ROOT, 'output')

ATTR_RE = re.compile(r'(?:href|src)="([^"]+)"')


def all_html_files():
    for dirpath, _dirs, files in os.walk(OUTPUT_DIR):
        for f in files:
            if f.endswith('.html'):
                yield os.path.join(dirpath, f)


def page_url(html_path):
    rel = os.path.relpath(html_path, OUTPUT_DIR).replace(os.sep, '/')
    if rel.endswith('index.html'):
        rel = rel[: -len('index.html')]
    return '/' + rel


def resolve_internal(path):
    path = path.split('#', 1)[0].split('?', 1)[0]
    if not path:
        return True
    fs_path = os.path.join(OUTPUT_DIR, path.lstrip('/').replace('/', os.sep))
    if path.endswith('/'):
        return os.path.isfile(os.path.join(fs_path, 'index.html'))
    if os.path.isfile(fs_path):
        return True
    return os.path.isfile(os.path.join(fs_path, 'index.html'))


def check_external(url, cache):
    if url in cache:
        return cache[url]
    try:
        req = Request(url, method='HEAD', headers={'User-Agent': 'Mozilla/5.0 (linkcheck)'})
        with urlopen(req, timeout=10) as resp:
            ok = resp.status < 400
    except HTTPError as e:
        ok = e.code < 400
    except URLError:
        ok = False
    except Exception:
        ok = False
    cache[url] = ok
    return ok


def main():
    broken_internal = []
    external_links = set()
    total_links = 0
    pages_checked = 0

    for html_path in all_html_files():
        pages_checked += 1
        with open(html_path, encoding='utf-8') as f:
            content = f.read()
        page = page_url(html_path)
        for m in ATTR_RE.finditer(content):
            link = m.group(1)
            total_links += 1
            if link.startswith(('mailto:', 'tel:', 'javascript:', '#')):
                continue
            if link.startswith(('http://', 'https://')):
                external_links.add(link)
                continue
            if not resolve_internal(link):
                broken_internal.append((page, link))

    print(f'Checked {pages_checked} generated pages, {total_links} href/src attributes.')
    print(f'Internal links/assets: {"OK - all resolved" if not broken_internal else str(len(broken_internal)) + " BROKEN"}')
    for page, link in broken_internal:
        print(f'  BROKEN internal: {link}  (found on {page})')

    print(f'\nChecking {len(external_links)} distinct external URLs (HEAD, 10s timeout)...')
    cache = {}
    broken_external = []
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = {pool.submit(check_external, url, cache): url for url in external_links}
        for fut in as_completed(futures):
            url = futures[fut]
            if not fut.result():
                broken_external.append(url)

    if broken_external:
        print(f'{len(broken_external)} external URL(s) did not respond OK:')
        for u in sorted(broken_external):
            print(f'  - {u}')
    else:
        print('All external URLs responded OK.')

    print('\n--- SUMMARY ---')
    print(f'Pages checked:      {pages_checked}')
    print(f'Broken internal:    {len(broken_internal)}')
    print(f'External checked:   {len(external_links)}')
    print(f'External failed:    {len(broken_external)}')

    return 1 if broken_internal else 0


if __name__ == '__main__':
    raise SystemExit(main())
