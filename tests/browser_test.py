"""描画・操作を実Chromiumで確認。環境のURL制限を避け、アセットを同一文書に埋め込んで検証する。"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).parent.parent
SHOTS = ROOT / 'test-artifacts'
SHOTS.mkdir(exist_ok=True)

html = (ROOT / 'index.html').read_text()
css = (ROOT / 'style.css').read_text()
script = (ROOT / 'script.js').read_text()
# このコンテナではファイル/httpへChromiumがアクセスできないため、実DOM＋隔離した保存模擬を使用。
storage_shim = '''<script>
if (!window.__taskclearTestStorage) window.__taskclearTestStorage = {};
Object.defineProperty(window, 'localStorage', {configurable:true,value:{
  getItem(key){return Object.prototype.hasOwnProperty.call(window.__taskclearTestStorage,key)?window.__taskclearTestStorage[key]:null},
  setItem(key,value){window.__taskclearTestStorage[key] = String(value)},
  removeItem(key){delete window.__taskclearTestStorage[key]}
}});
</script>'''
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>' + css + '</style>')
html = html.replace('<script src="script.js" defer></script>', '')
html = html.replace('</body>', storage_shim + '<script>' + script + '</script></body>')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for target, width, height in [('mobile', 390, 844), ('desktop', 1366, 900), ('small-phone', 320, 700)]:
        context = browser.new_context(viewport={'width': width, 'height': height}, accept_downloads=True)
        page = context.new_page()
        errors = []
        requests = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('request', lambda r: requests.append(r.url))
        page.on('dialog', lambda d: d.accept())
        page.goto('about:blank')
        page.set_content(html, wait_until='load')
        assert page.locator('#focus-heading').inner_text() == '今日、何から楽しもう？'
        page.screenshot(path=str(SHOTS / f'{target}-empty.png'), full_page=True)
        page.locator('#add-inline').click()
        page.locator('#item-name').fill('読みかけの冒険小説')
        page.locator('#item-category').select_option(label='本')
        page.locator('#item-next').fill('第3章から読む')
        page.locator('#item-notes').fill('通勤中に楽しむ')
        page.locator('#form-save').click()
        assert '読みかけの冒険小説' in page.locator('#focus-heading').inner_text()
        assert '第3章から読む' in page.locator('.focus-next-step').inner_text()
        page.locator('#focus-primary').click()
        assert page.locator('#focus-primary').inner_text().startswith('楽しんだ時間')
        page.locator('#focus-primary').click()
        assert page.locator('#log-dialog').evaluate('(d) => d.open')
        page.locator('button[data-minutes="30"]').click()
        page.locator('#log-note').fill('少し読み進められた')
        page.locator('#log-form button[type="submit"]').click()
        assert page.locator('#week-minutes').inner_text() == '30分'
        assert page.locator('#log-list li').count() == 1
        assert page.locator('#item-list .item-card').count() == 1
        page.locator('#toast').evaluate('(el) => el.hidden = true')
        page.screenshot(path=str(SHOTS / f'{target}-filled.png'), full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), f'horizontal overflow at {width}'
        page.locator('details.data-details summary').click()
        with page.expect_download() as download_info:
            page.locator('#export').click()
        download = download_info.value
        backup = SHOTS / f'{target}-backup.json'
        download.save_as(str(backup))
        data = json.loads(backup.read_text())
        assert data['version'] == 2 and data['logs'][0]['minutes'] == 30
        # ページ差し替えによる再描画。ネイティブ localStorage の永続化までは確認していない。
        page.set_content(html, wait_until='load')
        assert page.locator('#week-minutes').inner_text() == '30分'
        page.locator('#log-list .log-remove').first.click()
        assert page.locator('#week-minutes').inner_text() == '0分'
        page.locator('#import-file').set_input_files(str(backup))
        expect(page.locator('#week-minutes')).to_have_text('30分')
        assert not errors, f'{target} JS errors: {errors}'
        assert not requests, f'{target} unexpected requests: {requests}'
        print(f'PASS {target}: {width}x{height} DOM, create/start/log/export/re-render/delete/import; no horizontal overflow or JS error')
        context.close()
    browser.close()
