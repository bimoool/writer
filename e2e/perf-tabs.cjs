/*
 * Время вкладок проверки текста (SPEC §15.8) на 2000 и 10 000 слов в Chromium с замедлением CPU в 4 раза (CDP).
 * Запуск: npm run build && npx vite preview --port 4173 --host 127.0.0.1 &
 *         node e2e/perf-tabs.cjs [адрес]
 * Печатает для каждой вкладки время вычисления (performance.measure check:*) и время от нажатия до отрисовки.
 */
const fs = require('fs');
const path = require('path');
const { launch, seed, reporter } = require('./lib.cjs');

const BASE = process.argv[2] || 'http://127.0.0.1:4173/';
const r = reporter();

// Предложения для материала берём из калибровочных текстов (шаблонные кавычки в файле).
const fixture = fs.readFileSync(path.join(__dirname, '../src/lib/__fixtures__/calibration.ts'), 'utf8');
const texts = [...fixture.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const sentences = texts.flatMap((t) => t.split(/\n\n+/).flatMap((p) => p.match(/[^.!?]+[.!?]+/g) || [])).map((s) => s.trim()).filter(Boolean);
const appendix = fs.readFileSync(path.join(__dirname, '../src/i18n/sample.ts'), 'utf8').match(/`([^`]+)`/)[1].split(/\n\n+/).flatMap((p) => p.match(/[^.!?]+[.!?]+/g) || []).map((s) => s.trim());

function rng(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); }

/** Документ на около `words` слов: блоки по 3–4 предложения, абзац из трёх блоков. Исходник собран из других предложений. */
function bigDoc(words) {
  const rnd = rng(words);
  const pick = (pool) => pool[Math.floor(rnd() * pool.length)];
  const blocks = [];
  let total = 0;
  while (total < words) {
    const n = 3 + Math.floor(rnd() * 2);
    const user = Array.from({ length: n }, () => pick(sentences)).join(' ');
    const source = Array.from({ length: n }, () => pick([...appendix, ...sentences])).join(' ');
    total += user.split(/\s+/).length;
    const i = blocks.length;
    blocks.push({
      id: `p${i}`, paragraphIndex: Math.floor(i / 3), kind: 'text', sourceText: source, keyphrases: [], userText: user, status: 'done',
      hints: { maxLevel: 0, opens: { 1: 0, 2: 0, 3: 0 }, peeks: 0, peekMs: 0 }, typedChars: 100, pastedChars: 0, activeMs: 1000,
    });
  }
  return { id: 'perf', title: `Перф ${words}`, source: blocks.map((b) => b.sourceText).join('\n\n'), blockSize: 'short', manualEdits: false, blocks, currentIndex: blocks.length, createdAt: Date.now(), updatedAt: Date.now(), finishedAt: Date.now() };
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

(async () => {
  const rows = [];
  for (const words of [2000, 10000]) {
    const doc = bigDoc(words);
    const actual = doc.blocks.reduce((n, b) => n + b.userText.split(/\s+/).length, 0);
    const runs = { read: [], ai: [], cmp: [], readUi: [], aiUi: [], cmpUi: [] };
    for (let run = 0; run < 3; run++) {
      const { browser, ctx, page } = await launch({ width: 1280, height: 900 });
      await seed(page, BASE, [doc], 'result', doc.id);
      await page.getByRole('heading', { name: 'Готово' }).waitFor();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const click = (name) => page.evaluate(async (name) => {
        const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(name));
        const t = performance.now();
        el.click();
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        return performance.now() - t;
      }, name);
      runs.readUi.push(await click('Проверить текст'));
      runs.aiUi.push(await click('Шаблоны'));
      runs.cmpUi.push(await click('Сравнение'));
      const measures = await page.evaluate(() => Object.fromEntries(performance.getEntriesByType('measure').filter((m) => m.name.startsWith('check:')).map((m) => [m.name.slice(6), m.duration])));
      for (const k of ['read', 'ai', 'cmp']) runs[k].push(measures[k]);
      await browser.close();
    }
    const row = { words: actual, ...Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, Math.round(median(v))])) };
    rows.push(row);
    r.log(`~${words} слов (факт ${actual}, блоков ${doc.blocks.length}), CPU ×4, медиана из 3 загрузок, мс:`);
    r.log(`  Читаемость:  вычисление ${row.read}, до отрисовки ${row.readUi} (включая нажатие «Проверить текст»)`);
    r.log(`  Шаблоны:     вычисление ${row.ai}, до отрисовки ${row.aiUi}`);
    r.log(`  Сравнение:   вычисление ${row.cmp}, до отрисовки ${row.cmpUi}`);
  }
  const at2000 = rows[0];
  r.ok(at2000.read <= 300 && at2000.ai <= 300 && at2000.cmp <= 300, 'на 2000 слов каждая вкладка считается не дольше 300 мс');
  process.exit(r.failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
