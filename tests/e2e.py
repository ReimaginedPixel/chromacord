"""Browser tests for the editor. Optional, needs Python Playwright and Chrome.

    python3 -m http.server 8765 &
    python3 tests/e2e.py              # uses http://127.0.0.1:8765/
    CHROME=/path/to/chrome python3 tests/e2e.py
"""

import asyncio
import os
import sys

from playwright.async_api import async_playwright

URL = os.environ.get('URL', 'http://127.0.0.1:8765/')
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
ESC = '\u001b'
failures = []


def check(name, ok, detail=''):
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail and not ok else ''))
    if not ok:
        failures.append(name)


async def settle(page):
    await page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')


async def doc(page):
    return await page.evaluate('chromacord.editor.doc.text')


async def body(page):
    await settle(page)
    return await page.evaluate('chromacord.body')


async def select(page, start, end):
    await page.evaluate(f'chromacord.editor.focus(); chromacord.editor.select({start}, {end})')


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME, args=['--no-proxy-server'])
        ctx = await browser.new_context(viewport={'width': 1440, 'height': 900})
        await ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=URL.rstrip('/'))
        page = await ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        await page.goto(URL, wait_until='networkidle')

        # Typing, line breaks and deleting go through the model
        await page.evaluate("chromacord.editor.setDoc({text: '', keys: []})")
        await page.click('#editor')
        await page.keyboard.type('Hello world')
        await page.keyboard.press('Enter')
        await page.keyboard.type('Line two')
        check('typing and enter', await doc(page) == 'Hello world\nLine two', await doc(page))
        for _ in range(3):
            await page.keyboard.press('Backspace')
        check('backspace', await doc(page) == 'Hello world\nLine ', await doc(page))
        await page.keyboard.press('Control+Backspace')
        check('word delete', await doc(page) == 'Hello world\n', repr(await doc(page)))
        await page.keyboard.type('x')
        check('typing after a trailing line break', await doc(page) == 'Hello world\nx', repr(await doc(page)))
        await page.keyboard.press('Enter')
        await page.keyboard.press('Enter')
        check('two line breaks at the end', await doc(page) == 'Hello world\nx\n\n', repr(await doc(page)))
        await page.keyboard.type('y')
        check('typing on the last empty line', await doc(page) == 'Hello world\nx\n\ny', repr(await doc(page)))
        await page.keyboard.press('Home')
        await page.keyboard.press('Backspace')
        check('backspace joins lines', await doc(page) == 'Hello world\nx\ny', repr(await doc(page)))

        # Phone keyboards and IMEs edit the DOM themselves; the editor reads it back
        await page.evaluate("chromacord.editor.setDoc({text: 'ab', keys: ['0000|31|', '0000|31|']})")
        await page.evaluate("""() => {
            const ed = chromacord.editor.el;
            ed.dispatchEvent(new CompositionEvent('compositionstart'));
            ed.firstChild.firstChild.data = 'ab\u0105';
            ed.dispatchEvent(new InputEvent('input', { isComposing: true }));
            ed.dispatchEvent(new CompositionEvent('compositionend'));
        }""")
        check('composition is read back from the DOM', await doc(page) == 'ab\u0105' and (await body(page)) == f'{ESC}[0;31mab\u0105', repr(await body(page)))
        await page.evaluate("chromacord.editor.setDoc({text: 'Hello world\\nx\\ny', keys: Array(15).fill('0000||')})")

        # Coloring a selection with a classic swatch
        await select(page, 0, 5)
        await page.click('#classic .sw[data-color="31"]')
        check('classic red', (await body(page)).startswith(f'{ESC}[0;31mHello'), repr((await body(page))[:30]))
        check('selection kept after coloring', await page.evaluate('JSON.stringify(chromacord.editor.sel)') == '{"start":0,"end":5}')

        # Bright swatches sit on a second row and keep their own code
        check('classic and bright swatches', await page.locator('#classic .sw').count() == 16)
        await page.click('#classic .sw[data-color="91"]')
        check('bright red', (await body(page)).startswith(f'{ESC}[0;91mHello'), repr((await body(page))[:30]))
        check('bright swatch shows pressed', await page.get_attribute('#classic .sw[data-color="91"]', 'aria-pressed') == 'true')
        bright = await page.evaluate('''() => {
            const span = document.querySelector('#editor .a-f91');
            return span && getComputedStyle(span).color;
        }''')
        check('bright red uses the theme color', bright == 'rgb(255, 147, 142)', repr(bright))
        await page.click('#classic .sw[data-color="31"]')

        # Bold via shortcut and toolbar state
        await page.keyboard.press('Control+b')
        check('ctrl+b bolds', (await body(page)).startswith(f'{ESC}[1;31mHello'), repr((await body(page))[:30]))
        pressed = await page.get_attribute('.tool[data-cmd="b"]', 'aria-pressed')
        check('bold button shows pressed', pressed == 'true')

        # Undo and redo
        await page.keyboard.press('Control+z')
        check('undo removes bold', (await body(page)).startswith(f'{ESC}[0;31mHello'))
        await page.keyboard.press('Control+Shift+z')
        check('redo brings it back', (await body(page)).startswith(f'{ESC}[1;31mHello'))

        # Typing inherits the style before the caret
        await page.evaluate('chromacord.editor.select(5, 5)')
        await page.keyboard.type('!')
        check('typed text inherits style', (await body(page)).startswith(f'{ESC}[1;31mHello!'), repr(await doc(page)) + repr((await body(page))[:30]))

        # Effects: gradient preset on a word
        await page.click('#tab-effects')
        await select(page, 7, 12)
        await page.click('.preset[data-preset="sunset"]')
        b = await body(page)
        check('gradient preset applies 24-bit colors', b.count('38;2;') >= 4, repr(b))
        label = await page.inner_text('#apply-fx')
        check('apply button shows the count', label == 'Apply to 5 characters', label)
        await page.click('.mode[data-effect="bands"]')
        b2 = await body(page)
        check('changing the effect updates the same text', b2 != b and b2.count('38;2;') == 2, repr(b2))

        # Editing the effect colors updates text the effect was just applied to
        await page.evaluate("chromacord.load('Gradient me please')")
        await select(page, 0, 8)
        await page.click('.preset[data-preset="ocean"]')
        b1 = await body(page)
        await page.locator('#stops input[type=color]').first.fill('#000000')
        b2 = await body(page)
        check('changing a color re-applies the effect', b1 != b2 and '38;2;0;0;0m' in b2, repr(b2[:60]))
        await page.click('#reverse')
        b3 = await body(page)
        check('reverse flips the colors', b3 != b2 and b3.rstrip().count('38;2;0;0;0m') == 1, repr(b3[:60]))
        await page.click('.mode[data-effect="gradient"]')

        # Background target
        await page.click('#target [data-target="bg"]')
        await page.click('#tab-colors')
        await select(page, 0, 6)
        await page.click('#classic .sw[data-color="44"]')
        check('classic background', '44m' in (await body(page)), repr((await body(page))[:40]))
        await page.click('#classic .sw[data-color="104"]')
        check('bright background', '104m' in (await body(page)) and '44m' not in (await body(page)), repr((await body(page))[:40]))
        await page.click('#classic .sw[data-color="44"]')
        await page.click('#target [data-target="fg"]')

        # Word mode on backgrounds leaves the gaps clear
        await page.click('#target [data-target="bg"]')
        await page.click('#tab-effects')
        await page.evaluate("chromacord.load('ab cd')")
        await select(page, 0, 5)
        await page.click('.mode[data-effect="words"]')
        await page.click('#apply-fx')
        b = await body(page)
        check('background words keep spaces clear', b.count('48;2;') == 2 and f'{ESC}[0m ' in b, repr(b))
        await page.click('.mode[data-effect="gradient"]')
        await page.click('#target [data-target="fg"]')
        await page.click('#tab-colors')
        await page.evaluate("chromacord.load('Hello! world\\nx\\ny')")

        # Custom hex
        await select(page, 13, 14)
        await page.fill('#hex', '#12ab34')
        await page.click('#apply-hex')
        check('custom hex color', '38;2;18;171;52' in (await body(page)))
        check('recent color saved', await page.locator('#recent .sw[data-color="#12ab34"]').count() == 1)
        await page.fill('#hex', 'nope')
        await page.click('#apply-hex')
        check('invalid hex shows an error', await page.is_visible('#hex-error'))

        # Copy for Discord
        await page.evaluate("navigator.clipboard.writeText('')")
        await page.click('#copy')
        for _ in range(40):
            clip = await page.evaluate('navigator.clipboard.readText()')
            if clip:
                break
            await page.wait_for_timeout(50)
        msg = await page.evaluate('chromacord.message')
        clip = clip.replace('\r\n', '\n')  # the Windows clipboard hands back CRLF
        check('copy puts the message on the clipboard', clip == msg and clip.startswith('```ansi\n') and clip.endswith('\n```'), repr(clip[:60]))

        # Copy as an escaped string
        await page.click('#copy-more')
        await page.click('.menu-item:has-text("Escaped string")')
        for _ in range(40):
            clip = await page.evaluate('navigator.clipboard.readText()')
            if clip.startswith('"'):
                break
            await page.wait_for_timeout(50)
        check('escaped string format', clip.startswith('"```ansi\\n') and '\\u001b[' in clip and ESC not in clip, clip[:40])

        # Pasting ANSI keeps colors
        await page.evaluate("chromacord.editor.setDoc({text: '', keys: []})")
        await page.click('#editor')
        await page.evaluate(f"navigator.clipboard.writeText('```ansi\\n{ESC}[1;32mGreen{ESC}[0m and {ESC}[38;2;255;0;0mred\\n```')")
        await page.keyboard.press('Control+v')
        check('paste ANSI text', await doc(page) == 'Green and red', repr(await doc(page)))
        check('paste ANSI styles', (await body(page)).startswith(f'{ESC}[1;32mGreen'), repr(await body(page)))

        # Copy and paste inside the editor keeps styles
        await select(page, 0, 5)
        await page.keyboard.press('Control+c')
        await page.evaluate('chromacord.editor.select(13, 13)')
        await page.keyboard.press('Control+v')
        check('internal copy/paste keeps style', (await doc(page)) == 'Green and redGreen' and (await body(page)).endswith(f'{ESC}[1;32mGreen'), repr(await body(page)))

        # Share link round trip
        await page.click('#share')
        link = ''
        for _ in range(40):
            link = await page.evaluate('navigator.clipboard.readText()')
            if '#m=' in link:
                break
            await page.wait_for_timeout(50)
        check('share link copied', '#m=' in link, link)
        before = await body(page)
        page2 = await ctx.new_page()
        await page2.goto(link, wait_until='networkidle')
        await page2.wait_for_timeout(300)
        check('share link opens the message', await page2.evaluate('chromacord.body') == before)
        check('share link cleans the URL', '#m=' not in page2.url)
        await page2.close()

        # Import dialog
        await page.click('#more')
        await page.click('.menu-item:has-text("Import a message")')
        await page.fill('#import-text', '"\\u001b[0;31mImported\\u001b[0m"')
        await page.click('#import-go')
        check('import a bot string', await doc(page) == 'Imported' and (await body(page)).startswith(f'{ESC}[0;31m'), repr(await body(page)))
        await page.click('#more')
        await page.click('.menu-item:has-text("Import a message")')
        await page.fill('#import-text', '"\\u001b[1;91;100mImported\\u001b[0m"')
        await page.click('#import-go')
        check('import keeps bright colors', await doc(page) == 'Imported' and (await body(page)).startswith(f'{ESC}[1;91;100m'), repr(await body(page)))

        # Templates
        await page.click('#tab-templates')
        await page.evaluate('chromacord.editor.select(8, 8)')
        await page.click('.tpl:has-text("Server status")')
        d = await doc(page)
        check('template inserted on a new line', d.startswith('Imported\nServer status'), repr(d[:30]))
        await page.keyboard.press('Control+z')
        check('undo removes the template', await doc(page) == 'Imported')

        # Meter states
        await page.evaluate("chromacord.load('x'.repeat(2100))")
        await settle(page)
        check('meter warns past 2,000', await page.get_attribute('#meter', 'data-state') == 'nitro')
        await page.evaluate("chromacord.load('x'.repeat(4100))")
        await settle(page)
        check('meter errors past 4,000', await page.get_attribute('#meter', 'data-state') == 'over')

        # Codes view
        await page.evaluate("chromacord.load('\\u001b[1;31mHi\\u001b[0m there')")
        await page.click('#codes-toggle')
        toks = await page.locator('#codes-body .tok').count()
        check('codes view lists codes', toks == 2, str(toks))
        await page.click('#codes-toggle')

        # Draft survives a reload
        await page.evaluate("chromacord.load('\\u001b[0;35mSaved draft')")
        await page.wait_for_timeout(600)
        await page.reload(wait_until='networkidle')
        check('draft restored after reload', await doc(page) == 'Saved draft' and (await body(page)).startswith(f'{ESC}[0;35m'))

        check('no console errors', not errors, '; '.join(errors))
        await browser.close()

    print(f'\n{len(failures)} failed' if failures else '\nall browser checks passed')
    sys.exit(1 if failures else 0)


asyncio.run(main())
