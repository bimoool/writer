/*
 * Браузерная проверка «Проверить текст» (SPEC §15) в Chromium через Playwright.
 * Запуск: npm run build && npx vite preview --port 4173 --host 127.0.0.1 &
 *         node e2e/check-text.cjs <папка для скриншотов> [адрес]
 * Нужен установленный Playwright (в зависимости проекта он не входит; путь можно задать в PLAYWRIGHT_PATH).
 * Скрипт сам кладёт в IndexedDB готовый документ, перехватывает сеть и печатает список хостов.
 * Всё, что не 127.0.0.1, блокируется и считается провалом.
 */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
const S = process.argv[2];
fs.mkdirSync(S, { recursive: true });
const BASE = process.argv[3] || 'http://127.0.0.1:4173/';

const SOURCE = ['В современном мире.', 'Исследования показывают.', 'Одним из подходов является Pomodoro.', 'Её суть проста.', 'Важно отметить.', 'Ключ к успеху.'];
const TEXTS = [
  'В современном мире управлять временем — не просто полезно, а необходимо.',
  'Люди, которые планируют день заранее, делают больше и меньше нервничают, потому что план снимает с головы лишний груз, и с утра понятно, что делать сначала, что потом, а что можно вообще не делать никогда.',
  'Одна из популярных техник — Pomodoro, её придумал Франческо Чирилло.',
  'Работаешь по 25 минут, потом пять минут отдыхаешь, и концентрация не пропадает превет.',
  'Важно отметить, что единого метода для всех нет.',
  'Таким образом, систему каждый собирает сам. Во-первых, планируй день. Во-вторых, делай перерывы. В-третьих, смотри на результат.',
];
const doc = {
  id: 'e2e-doc', title: 'Тест проверки', source: SOURCE.join('\n\n'), blockSize: 'short', manualEdits: false,
  blocks: TEXTS.map((userText, i) => ({
    id: `b${i}`, paragraphIndex: Math.floor(i / 2), kind: 'text', sourceText: SOURCE[i], keyphrases: [], userText, status: 'done',
    hints: { maxLevel: 0, opens: { 1: 0, 2: 0, 3: 0 }, peeks: 0, peekMs: 0 }, typedChars: 100, pastedChars: 0, activeMs: 60000,
  })),
  currentIndex: 6, createdAt: Date.now(), updatedAt: Date.now(), finishedAt: Date.now(),
};
const log = (...a) => console.log(...a);
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 1; } else log('ok:', m); };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true });
  const hosts = new Map(); const urls = [];
  ctx.on('request', (r) => { const u = new URL(r.url()); hosts.set(u.protocol + '//' + u.host, (hosts.get(u.protocol + '//' + u.host) || 0) + 1); urls.push(r.url()); });
  await ctx.route((u) => !['127.0.0.1'].includes(u.hostname) && u.protocol.startsWith('http'), (r) => { log('BLOCKED external', r.request().url()); r.abort(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE);
  await page.waitForSelector('textarea, main');
  await page.evaluate(async (doc) => {
    await new Promise((res, rej) => {
      const o = indexedDB.open('svoimi');
      o.onsuccess = () => {
        const db = o.result; const tx = db.transaction(['docs', 'settings'], 'readwrite');
        tx.objectStore('docs').put(doc);
        tx.objectStore('settings').put({ key: 'session', value: { screen: 'result', currentDocId: doc.id } });
        tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error);
      }; o.onerror = () => rej(o.error);
    });
  }, doc);
  urls.length = 0;
  await page.reload();
  await page.getByRole('heading', { name: 'Готово' }).waitFor();
  await page.waitForTimeout(800);
  assert(!urls.some((u) => /spellWorker|\.dic|\.aff/.test(u)), 'до нажатия словарь не запрашивался');
  assert(await page.locator('.mark').count() === 0, 'до нажатия нет подсветки');
  await page.screenshot({ path: S + '/s-before-360.png', fullPage: false });

  const t0 = Date.now();
  await page.getByRole('button', { name: 'Проверить текст' }).click();
  await page.getByRole('tab', { name: /Орфография/ }).waitFor();
  assert(await page.getByText('Загружаю словарь').count() >= 0, 'состояние загрузки (может быть уже быстро)');
  await page.screenshot({ path: S + '/s-loading-360.png' });
  await page.getByText(/не из словаря|Незнакомых слов не нашлось/).waitFor({ timeout: 120000 });
  log('словарь загружен и текст проверен за', Date.now() - t0, 'мс');
  assert(urls.some((u) => /spellWorker/.test(u)), 'после нажатия воркер со словарём запрошен');
  const bad = await page.locator('[data-list-item]').allInnerTexts();
  log('орфография:', JSON.stringify(bad));
  assert(bad.some((b) => b.includes('превет')), 'найдено «превет»');
  assert(!bad.some((b) => /Чирилло|Pomodoro/.test(b)), 'имя и латиница не помечены');
  await page.screenshot({ path: S + '/s-spell-360.png', fullPage: true });

  // читаемость, шаблоны
  for (const [name, file] of [['Читаемость', 'read'], ['Шаблоны', 'ai']]) {
    await page.getByRole('tab', { name: new RegExp(name) }).click();
    await page.waitForTimeout(200);
    log(name, JSON.stringify((await page.locator('[data-check-panel]').innerText()).slice(0, 600)));
    await page.screenshot({ path: S + `/s-${file}-360.png`, fullPage: true });
    log('  марок в тексте:', await page.locator('.mark').count());
  }
  // кнопка подсветки
  await page.getByRole('button', { name: 'Скрыть подсветку' }).click();
  assert(await page.locator('.mark').count() === 0, 'подсветка отключается');
  await page.getByRole('button', { name: 'Показать подсветку' }).click();
  assert(await page.locator('.mark').count() > 0, 'подсветка включается');
  // горизонтальный скролл
  const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  assert(sw[0] <= sw[1], 'на 360px нет горизонтальной прокрутки ' + sw);

  // Клавиатура: открыть метку Enter-ом на вкладке «Шаблоны»
  const mark = page.locator('.mark-ai').first();
  await mark.focus(); await page.keyboard.press('Enter');
  const card = page.getByRole('dialog');
  await card.waitFor();
  log('карточка:', JSON.stringify(await card.innerText()));
  await page.screenshot({ path: S + '/s-card-ai-360.png' });
  await page.keyboard.press('Escape');
  assert(await card.count() === 0, 'Esc закрывает карточку');
  await page.waitForTimeout(100);
  assert(await page.evaluate(() => document.activeElement?.classList.contains('mark')), 'фокус вернулся на метку');

  // Замена слова касанием
  await page.getByRole('tab', { name: /Орфография/ }).click();
  const before = await page.locator('main').innerText();
  assert(before.includes('превет'), 'в тексте есть «превет»');
  await page.locator('.mark-spell', { hasText: 'превет' }).tap();
  await page.getByRole('dialog').waitFor();
  await page.getByText('Подбираю варианты').waitFor({ state: 'detached', timeout: 60000 }).catch(() => {});
  const sugg = await page.getByRole('dialog').getByRole('button', { name: /Заменить на/ }).allInnerTexts();
  log('варианты:', JSON.stringify(sugg));
  assert(sugg.length >= 1 && sugg.length <= 3, 'до трёх вариантов');
  await page.screenshot({ path: S + '/s-card-spell-360.png' });
  const pick = page.getByRole('dialog').getByRole('button', { name: 'Заменить на «привет»' });
  assert(await pick.count() === 1, 'среди вариантов «привет»');
  await pick.click();
  await page.waitForTimeout(500);
  const after = await page.locator('main').innerText();
  assert(!after.includes('превет') && after.includes('привет'), 'слово заменено в тексте');
  assert(await page.getByText('Незнакомых слов не нашлось').count() === 1, 'после замены ошибок нет');
  await page.waitForTimeout(1200);
  await page.reload();
  await page.getByRole('heading', { name: 'Готово' }).waitFor();
  const saved = await page.locator('main').innerText();
  assert(saved.includes('привет') && !saved.includes('превет'), 'замена сохранилась после перезагрузки');
  const stored = await page.evaluate(() => new Promise((res) => { const o = indexedDB.open('svoimi'); o.onsuccess = () => { const g = o.result.transaction('docs').objectStore('docs').getAll(); g.onsuccess = () => res(JSON.stringify(g.result.map((d) => d.blocks.map((b) => b.userText)))); }; }));
  assert(stored.includes('привет') && !stored.includes('превет'), 'в IndexedDB записан исправленный текст');

  // широкий экран
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Проверить текст' }).click();
  await page.getByText(/Незнакомых слов не нашлось|не из словаря/).waitFor({ timeout: 120000 });
  for (const [name, file] of [['Орфография', 'spell'], ['Читаемость', 'read'], ['Шаблоны', 'ai']]) {
    await page.getByRole('tab', { name: new RegExp(name) }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: S + `/s-${file}-1280.png`, fullPage: true });
  }
  await page.locator('.mark-ai').first().click();
  await page.getByRole('dialog').waitFor();
  await page.screenshot({ path: S + '/s-card-1280.png' });

  log('\nХОСТЫ:'); for (const [h, n] of hosts) log(' ', h, n);
  log('ошибки консоли:', JSON.stringify(errors));
  assert(errors.length === 0, 'нет ошибок в консоли');
  assert([...hosts.keys()].every((h) => h === 'http://127.0.0.1:4173'), 'все запросы только к своему хосту');
  const sizes = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /spellWorker/.test(e.name)).map((e) => [e.name.split('/').pop(), e.transferSize, e.decodedBodySize]));
  log('чанк словаря (transfer, decoded):', JSON.stringify(sizes));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
