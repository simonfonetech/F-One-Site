"""Build the site, then serve output/ locally for preview."""
import os
import sys
import subprocess
import http.server

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUTPUT_DIR = os.path.join(ROOT, 'output')
PORT = 8099


class PreviewHandler(http.server.SimpleHTTPRequestHandler):
    """Serves output/ without the noisy traceback when a browser hangs up.

    Pages here pull ~90 images, so a browser navigating away mid-load aborts
    connections routinely. That is normal, not a server fault -- log one line
    instead of a full stack trace.
    """

    def __init__(self, *args, **kwargs):
        # Serve via directory= rather than os.chdir(). Holding output/ as the
        # process CWD locks it on Windows, so a concurrent `python
        # _build/build.py` fails partway through its rmtree and leaves output/
        # half-deleted. This keeps rebuilds safe while the server is running.
        super().__init__(*args, directory=OUTPUT_DIR, **kwargs)

    def end_headers(self):
        # SimpleHTTPRequestHandler sends Last-Modified but no Cache-Control, so
        # browsers cache CSS/JS heuristically and never revalidate -- a rebuild
        # then appears to have done nothing until a hard refresh. This is a
        # preview server, so tell the browser to check every time.
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            self.close_connection = True
            print(f'{self.address_string()} - client disconnected early')


def main():
    subprocess.run([sys.executable, os.path.join(ROOT, '_build', 'build.py')], check=True)

    # ThreadingHTTPServer, not the single-threaded TCPServer: a browser holds
    # keep-alive connections open, which blocked every other client (a second
    # tab, or a Playwright run) until the first one closed.
    with http.server.ThreadingHTTPServer(('127.0.0.1', PORT), PreviewHandler) as httpd:
        print(f'Serving {OUTPUT_DIR} at http://localhost:{PORT}')
        httpd.serve_forever()


if __name__ == '__main__':
    main()
