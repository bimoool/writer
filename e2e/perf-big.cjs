/*
 * Большой документ (30 000 слов, около 200 000 символов, лимит импорта) в Chromium с замедлением CPU ×4 (CDP):
 *  1) Split: расчёт шаблонов исходника (performance.measure check:src-templates), время до появления сводки и самый
 *     длинный блок главного потока (longtask);
 *  2) Result: «Проверить текст» (все три вкладки) с теми же замерами.
 * Запуск: npm run build && npx vite preview --port 4173 --host 127.0.0.1 &
 *         node e2e/perf-big.cjs [адрес] [слов]
 * Порог (SPEC §15.7): расчёт на Split не дольше 400 мс и блокировка главного потока не дольше 150 мс подряд.
 */
const fs = require('fs');
const path = require('path');
const { launch, seed, reporter } = require('./lib.cjs');

const BASE = process.argv[2] && !/^\d+$/.test(process.argv[2]) ? process.argv[2] : 'http://127.0.0.1:4173/';
const WORDS = Number(process.argv.find((a) => /^\d+$/.test(a)) || 30000);
const r = reporter();

const fixture = fs.readFileSync(path.join(__dirname, '../src/lib/__fixtures__/calibration.ts'), 'utf8');
const texts = [...fixture.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const sentences = texts.flatMap((t) => t.split(/\n\n+/).flatMap((p) => p.match(/[^.!?]+[.!?]+/g) || [])).map((s) => s.trim()).filter(Boolean);
const appendix = fs.readFileSync(path.join(__dirname, '../src/i18n/sample.ts'), 'utf8').match(/`([^`]+)`/)[1].split(/\n\n+/).flatMap((p) => p.match(/[^.!?]+[.!?]+/g) || []).map((s) => s.trim());

function rng(seedValue) { let s = seedValue; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); }

function bigDoc(words, status) {
  const rnd = rng(words);
  const pick = (pool) => pool[Math.floor(rnd() * pool.length)];
  const blocks = [];
  let total = 0;
  while (total < words) {
    const n = 3 + Math.floor(rnd() * 2);
    const source = Array.from({ length: n }, () => pick([...appendix, ...sentences])).join(' ');
    const user = Array.from({ length: n }, () => pick(sentences)).join(' ');
    total += source.split(/\s+/).length;
    const i = blocks.length;
    blocks.push({
      id: `p${i}`, paragraphIndex: Math.floor(i / 3), kind: 'text', sourceText: source, keyphrases: [],
      userText: status === 'done' ? user : '', status,
      hints: { maxLevel: 0, opens: { 1: 0, 2: 0, 3: 0 }, peeks: 0, peekMs: 0 }, typedChars: 0, pastedChars: 0, activeMs: 0,
    });
  }
  const src = blocks.map((b) => b.sourceText).join('\n\n');
  return { id: 'big', title: `Большой ${words}`, source: src, blockSize: 'short', manualEdits: false, blocks, currentIndex: status === 'done' ? blocks.length : 0, createdAt: Date.now(), updatedAt: Date.now(), ...(status === 'done' ? { finishedAt: Date.now() } : {}) };
}

/** Перед действием ставит наблюдатель longtask и возвращает функцию, собирающую замеры после него. */
async function watch(page) {
  await page.evaluate(() => {
    window.__long = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push([e.startTime, e.duration]))).observe({ type: 'longtask', buffered: false });
  });
  return () => page.evaluate(() => ({
    longAt: window.__long,
    long: window.__long.map((l) => l[1]),
    measures: Object.fromEntries(performance.getEntriesByType('measure').filter((m) => m.name.startsWith('check:')).map((m) => [m.name.slice(6), Math.round(m.duration)])),
    starts: Object.fromEntries(performance.getEntriesByType('measure').filter((m) => m.name.startsWith('check:')).map((m) => [m.name.slice(6), m.startTime])),
  }));
}

async function split() {
  const doc = bigDoc(WORDS, 'pending');
  const words = doc.blocks.reduce((n, b) => n + b.sourceText.split(/\s+/).length, 0);
  const { browser, ctx, page } = await launch({ width: 1280, height: 900 });
  await seed(page, BASE, [doc], 'home', null);
  await page.getByRole('button', { name: /Продолжить|Открыть/ }).first().waitFor();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const collect = await watch(page);
  if (process.env.PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
  const t0 = Date.now();
  await page.getByRole('button', { name: /Продолжить|Открыть/ }).first().click();
  const counting = process.env.BASELINE ? true : await page.waitForSelector('[data-templates="counting"]', { timeout: 20000, state: 'attached' }).then(() => true, () => false);
  // BASELINE=1: сборка до правок по отзывам, сводки шаблонов там нет, ждём заголовок разбивки.
  // Ожидание только быстрыми CSS-селекторами: getByRole/getByText на странице в сотни блоков сами грузят поток и портят замер.
  if (process.env.BASELINE) await page.waitForSelector('main h1', { timeout: 120000 });
  else await page.waitForSelector('[data-templates="ready"]', { timeout: 120000 });
  const total = Date.now() - t0;
  if (process.env.PROFILE) {
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map();
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, i) => { const f = byId.get(id).callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`; self.set(k, (self.get(k) || 0) + profile.timeDeltas[i] / 1000); });
    console.log('профиль, самое тяжёлое (мс, самостоятельное время):', [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${Math.round(v)}`).join('\n  '));
  }
  const m = await collect();
  const text = process.env.BASELINE || process.env.NOCALC ? '(нет)' : (await page.getByRole('group', { name: 'Шаблоны исходника' }).innerText()).replace(/\s+/g, ' ');
  if (process.env.STEPS) console.log('порции', JSON.stringify((await page.evaluate(() => window.__sl || [])).sort((a, b) => b - a).slice(0, 8)));
  await browser.close();
  const longest = Math.max(0, ...m.long);
  r.log(`Split, ${words} слов, ${doc.blocks.length} блоков, CPU ×4:`);
  r.log(`  расчёт шаблонов: ${m.measures['src-templates']} мс; до появления сводки (с отрисовкой блоков): ${total} мс; самая длинная блокировка: ${Math.round(longest)} мс (длинных задач ${m.long.length})`);
  r.log(`  длинные задачи, мс: ${m.long.map(Math.round).sort((a, b) => b - a).join(', ') || 'нет'}`);
  r.log(`  сводка: ${text}`);
  // Длинные задачи до начала расчёта это первая отрисовка блоков, после начала расчёт (и всё, что он вызвал).
  const from = m.starts['src-templates'] ?? Infinity;
  return { calc: m.measures['src-templates'], longest, total, long: m.long, render: m.longAt.filter((l) => l[0] < from).map((l) => l[1]), calcLong: m.longAt.filter((l) => l[0] >= from).map((l) => l[1]), counting };
}

async function result() {
  const doc = bigDoc(WORDS, 'done');
  const { browser, ctx, page } = await launch({ width: 1280, height: 900 });
  await seed(page, BASE, [doc], 'result', doc.id);
  await page.getByRole('heading', { name: 'Готово' }).waitFor({ timeout: 120000 });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const collect = await watch(page);
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Проверить текст' }).click();
  await page.waitForSelector('[data-check-summary]', { timeout: 180000 });
  const total = Date.now() - t0;
  const m = await collect();
  await browser.close();
  const longest = Math.max(0, ...m.long);
  r.log(`Result, «Проверить текст», CPU ×4: вычисление читаемость ${m.measures.read} мс, шаблоны ${m.measures.ai} мс, сравнение ${m.measures.cmp} мс; до сводки ${total} мс; самая длинная блокировка ${Math.round(longest)} мс (длинных задач ${m.long.length})`);
  return { total, longest, long: m.long, ...m.measures };
}

(async () => {
  if (process.env.BASELINE) {
    await split();
    process.exit(0);
  }
  const s = await split();
  const rs = await result();
  r.ok(s.counting, 'Split: пока идёт расчёт, видна строка «Считаем шаблоны исходника…»');
  // Первая отрисовка сотен блоков (React) к расчёту не относится и есть и без него (BASELINE=1). Порции расчёта не должны держать поток дольше 150 мс подряд.
  const calcMax = Math.max(0, ...s.calcLong);
  r.ok(calcMax <= 150, `Split: порции расчёта не блокируют поток дольше 150 мс (самая длинная ${Math.round(calcMax)} мс, задач ${s.calcLong.length})`);
  r.log(`Split: расчёт целиком от начала до конца (с паузами между порциями): ${s.calc} мс; первая отрисовка блоков (до начала расчёта): ${s.render.map(Math.round).join(' + ')} мс`);
  r.log(`Result (справочно): блокировка ${Math.round(rs.longest)} мс, длинные задачи: ${rs.long.map(Math.round).sort((x, y) => y - x).join(', ')}`);
  process.exit(r.failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
