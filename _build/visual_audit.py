"""Capture matched screenshots and computed-style snapshots for visual parity work.

Usage:
    python _build/visual_audit.py [output-directory]
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "output" / "visual-audit"
# Use an installed Chrome when there is one, otherwise fall back to the
# Chromium that ships with Playwright (`python -m playwright install chromium`),
# so this runs on a machine without Chrome.
CHROME = next(
    (
        p
        for p in (
            Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
            Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
        )
        if p.is_file()
    ),
    None,
)

SITES = {
    "live": "https://fonetech.uk",
    "local": "http://localhost:8099",
}

PAGES = {
    "home": "/",
    "about": "/about-us/",
    "phones": "/cloud-phone-systems/",
    "connectivity": "/internet-connectivity/",
    "blog": "/blog/",
}

VIEWPORTS = {
    "desktop": {"width": 1440, "height": 1000},
    "mobile": {"width": 390, "height": 844},
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    report: dict[str, object] = {}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME) if CHROME else None,
            headless=True,
            args=["--disable-gpu", "--hide-scrollbars", "--no-sandbox"],
        )

        for viewport_name, viewport in VIEWPORTS.items():
            context = browser.new_context(
                viewport=viewport,
                device_scale_factor=1,
                reduced_motion="reduce",
            )

            for site_name, base_url in SITES.items():
                for page_name, path in PAGES.items():
                    key = f"{site_name}-{page_name}-{viewport_name}"
                    page = context.new_page()
                    failed: list[str] = []
                    page.on(
                        "requestfailed",
                        lambda request, failed=failed: failed.append(
                            f"{request.url} :: {request.failure}"
                        ),
                    )

                    try:
                        page.goto(
                            f"{base_url}{path}",
                            wait_until="domcontentloaded",
                            timeout=45_000,
                        )
                        try:
                            page.wait_for_load_state("networkidle", timeout=12_000)
                        except Exception:
                            pass
                        page.wait_for_timeout(2_000)
                        page.screenshot(path=str(OUT / f"{key}.png"), full_page=True)
                        report[key] = collect_page_data(page, failed)
                        print(f"captured {key}", flush=True)
                    except Exception as exc:
                        report[key] = {"url": page.url, "error": str(exc), "failed": failed}
                        print(f"failed {key}: {exc}", flush=True)
                    finally:
                        page.close()

            context.close()

        browser.close()

    with (OUT / "report.json").open("w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)


def collect_page_data(page, failed: list[str]) -> dict[str, object]:
    data = page.evaluate(
        """
        () => {
          const round = value => Math.round(value * 10) / 10;
          const text = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          const visible = el => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden';
          };
          const snapshot = el => {
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return {
              tag: el.tagName.toLowerCase(),
              text: text(el).slice(0, 180),
              id: el.id || '',
              className: typeof el.className === 'string' ? el.className : '',
              rect: {
                x: round(rect.x), y: round(rect.y + scrollY),
                width: round(rect.width), height: round(rect.height),
              },
              color: style.color,
              backgroundColor: style.backgroundColor,
              fontFamily: style.fontFamily,
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              lineHeight: style.lineHeight,
              letterSpacing: style.letterSpacing,
              textAlign: style.textAlign,
              display: style.display,
              alignItems: style.alignItems,
              justifyContent: style.justifyContent,
              gap: style.gap,
              margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft],
              padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
              borderRadius: style.borderRadius,
            };
          };

          const contentRoot = document.querySelector('.site-main, main') || document.body;
          const content = [...contentRoot.querySelectorAll('h1,h2,h3,h4,p,.gb-button,button')]
            .filter(visible)
            .slice(0, 180)
            .map(snapshot);
          const buttons = [...document.querySelectorAll('a.gb-button, .gb-button, button')]
            .filter(visible)
            .slice(0, 120)
            .map(snapshot);
          const carousels = [...document.querySelectorAll('.wp-block-cb-carousel')]
            .map(el => ({
              ...snapshot(el),
              dataSlick: el.getAttribute('data-slick'),
              children: el.children.length,
              slides: el.querySelectorAll('.wp-block-cb-slide').length,
            }));

          return {
            url: location.href,
            title: document.title,
            document: {
              width: document.documentElement.scrollWidth,
              height: document.documentElement.scrollHeight,
            },
            body: snapshot(document.body),
            header: document.querySelector('.site-header, header') ?
              snapshot(document.querySelector('.site-header, header')) : null,
            content,
            buttons,
            carousels,
            stylesheets: [...document.styleSheets].map(sheet => sheet.href).filter(Boolean),
          };
        }
        """
    )
    data["failed"] = failed
    return data


if __name__ == "__main__":
    main()
