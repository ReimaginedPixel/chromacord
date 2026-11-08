"""Regenerate every image the README and the site use.

    pip install playwright pillow      # Chrome or Chromium must be installed
    python3 scripts/screenshots.py      # CHROME=/path/to/chrome to override

Writes:
    assets/img/og.png, favicon-32.png, apple-touch-icon.png
    docs/screenshots/*.png and docs/demo.gif (the GIF needs ffmpeg)
"""

import asyncio
import base64
import functools
import http.server
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'docs' / 'screenshots'
IMG = ROOT / 'assets' / 'img'
CHROME = os.environ.get('CHROME') or shutil.which('google-chrome') or shutil.which('chromium') or shutil.which('chromium-browser')


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f'http://127.0.0.1:{httpd.server_port}/'


async def fresh(page, url, template=None, tab='colors', theme='ash'):
    """Open the app with clean storage and an optional template loaded."""
    await page.goto(url, wait_until='networkidle')
    await page.evaluate(f"""() => {{
        localStorage.clear();
        localStorage.setItem('chromacord:seen', 'true');
        localStorage.setItem('chromacord:tab', '"{tab}"');
        localStorage.setItem('chromacord:theme', '"{theme}"');
    }}""")
    await page.reload(wait_until='networkidle')
    await page.evaluate('document.fonts.ready')
    if template:
        await page.evaluate(f"""async () => {{
            const {{ TEMPLATES }} = await import('./assets/js/data/templates.js');
            const D = await import('./assets/js/core/doc.js');
            chromacord.editor.setDoc(D.fromRuns(TEMPLATES.find((t) => t.id === '{template}').build()), {{ record: false }});
        }}""")
    await page.evaluate("document.getElementById('msg-time').textContent = 'Today at 18:00'")
    await page.wait_for_timeout(300)


# ---------------------------------------------------------------- fake cursor

CURSOR_JS = """() => {
  if (document.getElementById('demo-cursor')) return;
  const c = document.createElement('div');
  c.id = 'demo-cursor';
  c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2.5v17.2l4.6-4.4 3 6.6 2.9-1.3-3-6.5 6.3-.2z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 9999, pointerEvents: 'none',
    transform: 'translate(640px, 560px)', transition: 'transform 520ms cubic-bezier(.3,.7,.2,1)' });
  document.body.append(c);
}"""


async def cursor_to(page, x, y, ms=420):
    await page.evaluate(f"(() => {{ const c = document.getElementById('demo-cursor'); c.style.transitionDuration = '{ms}ms'; c.style.transform = 'translate({x - 4}px, {y - 3}px)'; }})()")
    await page.wait_for_timeout(ms + 60)


async def click(page, selector, pause=450):
    box = await page.locator(selector).first.bounding_box()
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    await cursor_to(page, x, y)
    await page.mouse.click(x, y)  # no auto scrolling, so the frame stays still
    await page.wait_for_timeout(pause)


async def offset_xy(page, offset, end=False):
    return await page.evaluate(f"""() => {{
        const ed = chromacord.editor;
        const [n, o] = ed.pointAt({offset});
        const r = document.createRange();
        r.setStart(n, o); r.setEnd(n, o);
        const b = r.getClientRects()[0] || r.getBoundingClientRect();
        return [b.left, b.top + b.height / 2];
    }}""")


async def drag_select(page, start, end, steps=7):
    x, y = await offset_xy(page, start)
    await cursor_to(page, x, y, ms=420)
    for i in range(1, steps + 1):
        to = start + round((end - start) * i / steps)
        await page.evaluate(f'chromacord.editor.select({start}, {to})')
        x, y = await offset_xy(page, to)
        await cursor_to(page, x, y, ms=24)
    await page.wait_for_timeout(200)


# ------------------------------------------------------------------- images

async def static_images(browser, url):
    ctx = await browser.new_context(viewport={'width': 1200, 'height': 630}, device_scale_factor=1)
    page = await ctx.new_page()
    await page.goto(url + 'scripts/og.html', wait_until='networkidle')
    await page.wait_for_selector('body[data-ready]')
    await page.screenshot(path=str(IMG / 'og.png'))

    for size, name in [(32, 'favicon-32.png'), (180, 'apple-touch-icon.png')]:
        await page.set_viewport_size({'width': size, 'height': size})
        await page.set_content(f'<html><body style="margin:0;background:transparent"><img src="{url}assets/img/icon.svg" width="{size}" height="{size}" style="display:block"></body></html>')
        await page.wait_for_timeout(150)
        await page.screenshot(path=str(IMG / name), omit_background=True)
    await ctx.close()

    ctx = await browser.new_context(viewport={'width': 1400, 'height': 900}, device_scale_factor=2)
    page = await ctx.new_page()
    await page.goto(url + 'scripts/themes.html?t=console', wait_until='networkidle')
    await page.wait_for_selector('body[data-ready]')
    await page.locator('#grid').screenshot(path=str(SHOTS / 'themes.png'))
    await page.goto(url + 'scripts/vencord.html', wait_until='networkidle')
    await page.wait_for_selector('body[data-ready]')
    await page.locator('#grid').screenshot(path=str(SHOTS / 'vencord.png'))
    await ctx.close()


async def app_images(browser, url):
    ctx = await browser.new_context(viewport={'width': 1280, 'height': 800}, device_scale_factor=2)
    page = await ctx.new_page()

    await fresh(page, url, template='announcement', tab='effects')
    await page.screenshot(path=str(SHOTS / 'studio.png'))

    await fresh(page, url, template='status', tab='colors')
    await page.click('#codes-toggle')
    await page.wait_for_timeout(200)
    work = await page.locator('.work').bounding_box()
    codes = await page.locator('#codes').bounding_box()
    await page.screenshot(path=str(SHOTS / 'codes.png'), clip={
        'x': work['x'] - 16, 'y': work['y'] - 12, 'width': work['width'] + 32,
        'height': codes['y'] + codes['height'] - work['y'] + 28,
    })
    await page.click('#codes-toggle')

    await ctx.close()
    ctx = await browser.new_context(viewport={'width': 1280, 'height': 1600}, device_scale_factor=2)
    page = await ctx.new_page()
    await fresh(page, url, template='leaderboard', tab='templates')
    await page.evaluate("Object.assign(document.querySelector('.panel').style, { maxHeight: 'none', position: 'static' })")
    await page.locator('.panel').screenshot(path=str(SHOTS / 'templates.png'))
    await ctx.close()

    ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = await ctx.new_page()
    await fresh(page, url, template='bars', tab='colors')
    await page.screenshot(path=str(SHOTS / 'mobile.png'))
    await ctx.close()


async def demo_gif(browser, url):
    if not shutil.which('ffmpeg'):
        print('ffmpeg not found, skipping docs/demo.gif')
        return
    ctx = await browser.new_context(viewport={'width': 1180, 'height': 800}, device_scale_factor=1)
    page = await ctx.new_page()
    await fresh(page, url, tab='effects')
    await page.evaluate("chromacord.editor.setDoc({ text: '', keys: [] }, { record: false })")
    await page.evaluate(CURSOR_JS)

    frames = []
    cdp = await ctx.new_cdp_session(page)

    def on_frame(params):
        frames.append((params['metadata']['timestamp'], params['data']))
        asyncio.ensure_future(cdp.send('Page.screencastFrameAck', {'sessionId': params['sessionId']}))

    cdp.on('Page.screencastFrame', on_frame)
    await cdp.send('Page.startScreencast', {'format': 'png', 'everyNthFrame': 1})
    await page.wait_for_timeout(500)

    await click(page, '#editor', pause=100)
    await page.keyboard.type('Season 4 starts Friday!', delay=26)
    await page.keyboard.press('Enter')
    await page.keyboard.type('Ranks, kits and a bigger map.', delay=22)
    await page.wait_for_timeout(250)

    await drag_select(page, 0, 22)
    await click(page, '.preset[data-preset="vapor"]', pause=650)
    await click(page, '.preset[data-preset="sunset"]', pause=600)
    await click(page, '.preset[data-preset="rainbow"]', pause=550)
    await click(page, '.mode[data-effect="bands"]', pause=550)
    await click(page, '.tool[data-cmd="b"]', pause=300)
    await page.evaluate('chromacord.editor.select(23)')  # drop the selection to show the result
    await page.wait_for_timeout(650)

    await drag_select(page, 24, 35, steps=5)
    await click(page, '#tab-colors', pause=200)
    await click(page, '#classic .sw[data-color="36"]', pause=350)
    await page.evaluate('chromacord.editor.select(chromacord.editor.doc.text.length)')
    await page.wait_for_timeout(450)

    await click(page, '#themes [data-theme-id="light"]', pause=650)
    await click(page, '#themes [data-theme-id="ash"]', pause=350)
    await click(page, '#copy', pause=150)
    box = await page.locator('#copy').bounding_box()
    await cursor_to(page, box['x'] + box['width'] / 2, box['y'] + box['height'] + 70, ms=300)
    await page.wait_for_timeout(1400)

    await cdp.send('Page.stopScreencast')
    await ctx.close()
    if len(frames) < 10:
        print('not enough frames captured for the GIF')
        return

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        lines = []
        for i, (ts, data) in enumerate(frames):
            name = tmp / f'f{i:05d}.png'
            name.write_bytes(base64.b64decode(data))
            dur = (frames[i + 1][0] - ts) if i + 1 < len(frames) else 1.2
            lines.append(f"file '{name}'\nduration {max(dur, 0.02):.3f}")
        lines.append(f"file '{tmp / f'f{len(frames) - 1:05d}.png'}'")
        (tmp / 'list.txt').write_text('\n'.join(lines))
        out = ROOT / 'docs' / 'demo.gif'
        subprocess.run([
            'ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', str(tmp / 'list.txt'),
            '-vf', 'setpts=0.72*PTS,fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
            '-loop', '0', str(out),
        ], check=True)
        print(f'docs/demo.gif from {len(frames)} frames, {out.stat().st_size // 1024} KB')


async def main():
    if not CHROME:
        sys.exit('Chrome not found. Set CHROME=/path/to/chrome')
    SHOTS.mkdir(parents=True, exist_ok=True)
    httpd, url = serve()
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME, args=['--no-proxy-server', '--force-color-profile=srgb'])
        await static_images(browser, url)
        await app_images(browser, url)
        await demo_gif(browser, url)
        await browser.close()
    httpd.shutdown()
    for f in sorted(list(SHOTS.glob('*.png')) + list(IMG.glob('*.png'))):
        print(f.relative_to(ROOT), f.stat().st_size // 1024, 'KB')


asyncio.run(main())
