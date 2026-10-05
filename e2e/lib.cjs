/*
 * Общее для браузерных проверок (Playwright, Chromium). Нужен установленный Playwright
 * (в зависимости проекта он не входит; путь можно задать в PLAYWRIGHT_PATH).
 */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const SOURCE = [
  'В современном мире умение эффективно управлять своим временем становится не просто полезным навыком, а настоящей необходимостью.',
  'Исследования показывают, что люди, которые планируют свой день заранее, выполняют на 25% больше задач.',
  'Одним из наиболее популярных подходов является техника Pomodoro, разработанная Франческо Чирилло.',
  'Её суть заключается в том, чтобы работать короткими интервалами по 25 минут.',
  'Важно отметить, что не существует универсального метода, который подойдёт абсолютно всем.',
  'Ключ к успеху — экспериментировать с разными инструментами и наблюдать за собственной продуктивностью.',
];
const TEXTS = [
  'В современном мире управлять временем — не просто полезно, а необходимо.',
  'Люди, которые планируют день заранее, делают больше и меньше нервничают, потому что план снимает с головы лишний груз, и с утра понятно, что делать сначала, что потом, а что можно вообще не делать никогда.',
  'Одна из популярных техник — Pomodoro, её придумал Франческо Чирилло.',
  'Работаешь по 25 минут, потом пять минут отдыхаешь, и концентрация не пропадает.',
  'Важно отметить, что единого метода для всех нет.',
  'Таким образом, систему каждый собирает сам. Во-первых, планируй день. Во-вторых, делай перерывы. В-третьих, смотри на результат.',
];

function makeDoc({ id = 'e2e-doc', sources = SOURCE, texts = TEXTS, status = 'done' } = {}) {
  return {
    id, title: 'Тест проверки', source: sources.join('\n\n'), blockSize: 'short', manualEdits: false,
    blocks: sources.map((sourceText, i) => ({
      id: `${id}-b${i}`, paragraphIndex: Math.floor(i / 2), kind: 'text', sourceText, keyphrases: [], userText: texts[i] ?? '', status: texts[i] !== undefined ? status : 'pending',
      hints: { maxLevel: 0, opens: { 1: 0, 2: 0, 3: 0 }, peeks: 0, peekMs: 0 }, typedChars: 100, pastedChars: 0, activeMs: 60000,
    })),
    currentIndex: status === 'done' ? sources.length : 0, createdAt: Date.now(), updatedAt: Date.now(), ...(status === 'done' ? { finishedAt: Date.now() } : {}),
  };
}

/** Браузер с перехватом сети: всё, кроме 127.0.0.1, блокируется. hosts и urls копят то, что приложение пыталось запросить. */
async function launch({ width = 360, height = 740, scheme = 'dark' } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: width < 700, colorScheme: scheme });
  const net = { hosts: new Map(), urls: [], blocked: [] };
  ctx.on('request', (r) => {
    const u = new URL(r.url());
    const key = `${u.protocol}//${u.host}`;
    net.hosts.set(key, (net.hosts.get(key) || 0) + 1);
    net.urls.push(r.url());
  });
  await ctx.route((u) => u.protocol.startsWith('http') && u.hostname !== '127.0.0.1', (r) => {
    net.blocked.push(r.request().url());
    r.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { browser, ctx, page, net, errors };
}

/** Кладёт документы в IndexedDB приложения и открывает нужный экран. */
async function seed(page, base, docs, screen, currentDocId, theme = 'dark') {
  await page.goto(base);
  await page.waitForSelector('textarea, main');
  await page.evaluate(async ({ docs, screen, currentDocId, theme }) => {
    await new Promise((res, rej) => {
      const o = indexedDB.open('svoimi');
      o.onsuccess = () => {
        const db = o.result;
        const tx = db.transaction(['docs', 'settings'], 'readwrite');
        for (const d of docs) tx.objectStore('docs').put(d);
        tx.objectStore('settings').put({ key: 'session', value: { screen, currentDocId } });
        tx.objectStore('settings').put({ key: 'settings', value: { theme, defaultBlockSize: 'medium', pressure: 'off', pressureDelaySec: 6, allowPaste: false, writingFont: 'serif' } });
        tx.oncomplete = () => { db.close(); res(); };
        tx.onerror = () => rej(tx.error);
      };
      o.onerror = () => rej(o.error);
    });
  }, { docs, screen, currentDocId, theme });
  await page.reload();
}

const WORDS = `дерево река гора облако ветер камень трава птица рыба зверь песок озеро поле лес дорога мост башня сад окно стол книга лампа ключ зеркало часы ковёр свеча чашка тарелка нож вилка ложка кастрюля сковорода холодильник плита шкаф диван кресло подушка одеяло занавеска полка картина рамка ваза цветок букет подарок открытка конверт письмо газета журнал словарь тетрадь ручка карандаш линейка ластик портфель рюкзак чемодан билет паспорт карта компас фонарь палатка костёр спичка верёвка топор лопата ведро шланг лейка грабли ножницы молоток отвёртка пила гвоздь винт гайка болт цепь замок петля порог потолок стена лестница балкон крыльцо забор калитка ворота сарай погреб колодец пруд мельница кузница пекарня лавка рынок площадь улица переулок тупик перекрёсток тротуар светофор автобус трамвай троллейбус вокзал перрон вагон купе проводник кондуктор пассажир водитель механик инженер учитель врач повар художник музыкант писатель поэт актёр режиссёр архитектор строитель плотник слесарь`.split(/\s+/);
const groupWords = (words) => words.map((w, i) => (i % 6 === 5 ? `${w}.` : i % 6 === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(' ').replace(/\.\s+(\S)/g, (m, c) => `. ${c.toUpperCase()}`);

/** Документ, на котором есть что показать во всех вкладках проверки: штампы, мусор, повторы, начала, цепочка, длинное предложение, перенос из исходника, бедное окно слов. */
function makeRichDoc(id = 'e2e-rich') {
  const pairs = [
    ['В современном мире умение эффективно управлять своим временем становится не просто полезным навыком, а настоящей необходимостью.', 'В современном мире умение управлять своим временем становится не просто полезным навыком, а настоящей необходимостью.'],
    ['Исследования показывают, что люди, которые планируют свой день заранее, выполняют на 25% больше задач.', 'Исследования показывают, что люди, которые планируют свой день заранее, выполняют больше задач. По сути, план снимает тревогу.'],
    ['Одним из наиболее популярных подходов является техника Pomodoro, разработанная Франческо Чирилло.', 'Проект начался в марте. Проект шёл трудно, потому что команда была маленькой. Потом проект набрал темп.'],
    ['Её суть заключается в том, чтобы работать короткими интервалами по 25 минут.', 'Он пришёл первым. Он включил свет. Он поставил чайник. Все остальные пришли позже и сразу сели за столы.'],
    ['Важно отметить, что не существует универсального метода, который подойдёт абсолютно всем.', 'Когда задач становится слишком много, мы собираемся всей командой в переговорной комнате и по очереди разбираем каждую из них, чтобы понять, что можно отложить, что передать коллегам, а что действительно нужно закончить сегодня. Мы осуществляем контроль каждого этапа.'],
    ['Ключ к успеху — экспериментировать с разными инструментами и наблюдать за собственной продуктивностью.', 'Сначала мы договорились о сроках всей работы. Потом мы обсудили бюджет всего проекта. Затем мы подписали договор с обеими сторонами. Нужно проведение анализа результатов.'],
    ['Исходный блок про инструменты и привычки.', groupWords(WORDS.slice(0, 110))],
    ['Исходный блок про работу и людей.', groupWords(Array.from({ length: 110 }, (_, i) => (i % 3 === 0 ? 'работа' : i % 3 === 1 ? 'проект' : 'задача')))],
    ['Исходный блок про дом и сад.', groupWords(WORDS.slice(60, 170))],
  ];
  return makeDoc({ id, sources: pairs.map((p) => p[0]), texts: pairs.map((p) => p[1]) });
}

const readDocs = (page) =>
  page.evaluate(() => new Promise((res) => {
    const o = indexedDB.open('svoimi');
    o.onsuccess = () => { const g = o.result.transaction('docs').objectStore('docs').getAll(); g.onsuccess = () => res(g.result); };
  }));

function reporter() {
  let failed = 0;
  return {
    ok: (cond, msg) => { if (!cond) { failed++; console.log('FAIL:', msg); } else console.log('ok:', msg); },
    log: (...a) => console.log(...a),
    get failed() { return failed; },
  };
}

module.exports = { launch, seed, readDocs, makeDoc, makeRichDoc, reporter, SOURCE, TEXTS };
