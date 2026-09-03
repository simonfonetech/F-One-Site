"""Dev server: serve output/ and rebuild automatically when sources change.

    python _build/dev.py [--port 8951] [--host 0.0.0.0]

Why this exists: build.py deletes and recreates output/, and a plain
`python -m http.server` started *inside* output/ holds that folder as its
working directory, which on Windows makes the rmtree fail (WinError 32) and
leaves output/ half-deleted -- so every edit meant stop server, build, start
server. This serves output/ from the repo root instead (serve.py's handler,
which also sends no-cache headers so a rebuild shows on a normal refresh),
and watches content/, data/, templates/, static/, assets/ and build.py,
running the build in the background whenever something changes.

Watching is a 1s mtime poll rather than a filesystem-event library, so it
needs no extra packages; the tree is ~700 files, which stats in a few ms.
"""
import argparse
import http.server
import os
import subprocess
import sys
import threading
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.dirname(__file__))
from serve import PreviewHandler, OUTPUT_DIR  # noqa: E402

WATCH_DIRS = ['content', 'data', 'templates', 'static', 'assets']
WATCH_FILES = [os.path.join('_build', 'build.py')]
DEBOUNCE_SECONDS = 0.6
POLL_SECONDS = 1.0


def snapshot():
    """path -> mtime for everything we rebuild from."""
    seen = {}
    for rel in WATCH_DIRS:
        base = os.path.join(ROOT, rel)
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d != '__pycache__']
            for f in filenames:
                p = os.path.join(dirpath, f)
                try:
                    seen[p] = os.stat(p).st_mtime_ns
                except OSError:
                    pass
    for rel in WATCH_FILES:
        p = os.path.join(ROOT, rel)
        try:
            seen[p] = os.stat(p).st_mtime_ns
        except OSError:
            pass
    return seen


def build(reason):
    started = time.time()
    print(f'[dev] building ({reason}) ...', flush=True)
    for attempt in (1, 2):
        result = subprocess.run([sys.executable, os.path.join(ROOT, '_build', 'build.py')],
                                cwd=ROOT, capture_output=True, text=True)
        if result.returncode == 0:
            last = result.stdout.strip().splitlines()[-2:] if result.stdout.strip() else []
            print(f'[dev] built in {time.time() - started:.1f}s  {" | ".join(last)}', flush=True)
            return True
        # A request may have had a file open at the instant of the rmtree;
        # one retry after a moment covers that.
        print(f'[dev] build failed (attempt {attempt}):\n{result.stderr.strip()[-1500:]}', flush=True)
        if attempt == 1:
            time.sleep(1.0)
    return False


def watch():
    current = snapshot()
    pending_since = None
    while True:
        time.sleep(POLL_SECONDS)
        latest = snapshot()
        if latest != current:
            changed = [p for p in set(latest) | set(current) if latest.get(p) != current.get(p)]
            current = latest
            pending_since = time.time()
            print(f'[dev] change: {", ".join(os.path.relpath(p, ROOT) for p in sorted(changed)[:4])}'
                  f'{" ..." if len(changed) > 4 else ""}', flush=True)
        if pending_since and time.time() - pending_since >= DEBOUNCE_SECONDS:
            pending_since = None
            build('files changed')
            current = snapshot()  # the build itself touches nothing we watch, but be safe


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--port', type=int, default=8951)
    ap.add_argument('--host', default='0.0.0.0')
    args = ap.parse_args()

    if not build('startup'):
        sys.exit(1)

    threading.Thread(target=watch, daemon=True).start()
    with http.server.ThreadingHTTPServer((args.host, args.port), PreviewHandler) as httpd:
        print(f'[dev] serving {OUTPUT_DIR} at http://localhost:{args.port} -- watching for changes', flush=True)
        httpd.serve_forever()


if __name__ == '__main__':
    main()
