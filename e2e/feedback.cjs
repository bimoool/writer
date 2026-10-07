/*
 * Правки по отзывам первых пользователей в Chromium: навигация на Result, подсказки в Session, «Как это работает» на Home,
 * шаблоны исходника на Split, сводка и причины пустых результатов в проверке. Сеть перехвачена: любой внешний хост провал.
 * Запуск: npm run build && npx vite preview --port 4173 --host 127.0.0.1 &
 *         node e2e/feedback.cjs <папка для скриншотов> [адрес]
 * Скриншоты: 360 px в тёмной теме, один на 1280 px.
 */
const fs = require('fs');
const { launch, seed, readDocs, makeRichDoc, reporter } = require('./lib.cjs');

const OUT = process.argv[2] || 'e2e-out';
const BASE = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'http://127.0.0.1:4173/';
fs.mkdirSync(OUT, { recursive: true });
const r = reporter();

const readSettings = (page) =>
  page.evaluate(() => new Promise((res) => {
    const o = indexedDB.open('svoimi');
    o.onsuccess = () => { const g = o.result.transaction('settings').objectStore('settings').get('settings'); g.onsuccess = () => res(g.result?.value); };
  }));

async function journey() {
  const { browser, page, net, errors } = await launch();
  await page.goto(BASE);
  await page.getByRole('heading', { name: 'Вставь текст, который нужно пересказать' }).waitFor();

  // Home без документов: блок «Как это работает» из трёх строк.
  const how = page.getByRole('region', { name: 'Как это работает' });
  const steps = (await how.locator('li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  r.log('шаги:', JSON.stringify(steps));
  r.ok(steps.length === 3 && /Вставь текст, который дала нейросеть/.test(steps[0]) && /запомни: он растворится/.test(steps[1]) && /подсказки рядом, если забыл/i.test(steps[2]), 'Home: блок «Как это работает», три строки');
  r.ok(await page.getByRole('button', { name: 'Как это работает' }).count() === 0, 'Home без документов: ссылки-сворачивания нет');
  await page.screenshot({ path: `${OUT}/home-empty-360.png`, fullPage: true });

  // Пример → Split со сводкой шаблонов исходника.
  await page.getByRole('button', { name: 'Попробовать на примере' }).click();
  const summary = page.getByRole('group', { name: 'Шаблоны исходника' });
  await summary.waitFor();
  const sumText = (await summary.innerText()).replace(/\s+/g, ' ');
  r.log('сводка Split:', sumText);
  r.ok(/В исходнике найдено \d+ шаблонн\S+ мест\S* \(штампы \d+, словесный мусор \d+, ровный ритм \d+\)/.test(sumText), 'Split: сводка «найдено N шаблонных мест (штампы, мусор, ритм)»');
  const toggle = summary.getByRole('button', { name: 'Показать в тексте' });
  r.ok((await toggle.getAttribute('aria-pressed')) === 'false' && await page.locator('[class*="tpl-"]').evaluateAll((e) => e.filter((x) => x.closest('[data-block-text]')).length) === 0, 'Split: подсветка по умолчанию выключена');
  await toggle.click();
  await page.waitForSelector('[data-block-text] [class*="tpl-"]');
  const underlined = await page.locator('[data-block-text] [class*="tpl-"]').count();
  r.ok(underlined > 0 && (await toggle.getAttribute('aria-pressed')) === 'true', `Split: переключатель включает подчёркивание (${underlined} мест)`);
  const styles = await page.locator('[data-block-text] [class*="tpl-"]').first().evaluate((e) => { const c = getComputedStyle(e); return { style: c.textDecorationStyle, bg: c.backgroundColor }; });
  r.ok(styles.bg === 'rgba(0, 0, 0, 0)' && /dashed|dotted|double/.test(styles.style), `подчёркивание без фона, тип линии ${styles.style}`);
  r.ok(await page.locator('.marker').count() > 0, 'маркер ключевых фраз остаётся на месте');
  const overflow = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  r.ok(overflow[0] <= overflow[1], `Split на 360 px: нет горизонтальной прокрутки (${overflow})`);
  await page.screenshot({ path: `${OUT}/split-360.png` });
  await toggle.click();
  await page.waitForSelector('[data-block-text] [class*="tpl-"]', { state: 'detached' });
  r.ok(await page.locator('[data-block-text] [class*="tpl-"]').count() === 0, 'повторное нажатие выключает подсветку');

  // Home с документом: «Как это работает» свёрнут в ссылку.
  await page.getByRole('button', { name: /Мои тексты/ }).click();
  const link = page.getByRole('button', { name: 'Как это работает' });
  await link.waitFor();
  r.ok(await page.getByRole('region', { name: 'Как это работает' }).count() === 0 && (await link.getAttribute('aria-expanded')) === 'false', 'Home с документом: блок свёрнут в ссылку');
  await link.click();
  r.ok((await page.locator('[id="' + (await link.getAttribute('aria-controls')) + '"] li').count()) === 3, 'ссылка раскрывает те же три строки');
  await page.screenshot({ path: `${OUT}/home-docs-360.png`, fullPage: true });

  // Session: подпись, строка-намёк, исчезает после подсказки и остаётся скрытой после перезагрузки.
  await page.getByRole('button', { name: /Продолжить|Открыть/ }).first().click();
  await page.getByRole('button', { name: 'Начать' }).click();
  await page.getByRole('button', { name: 'Запомнил' }).waitFor();
  r.ok(await page.getByRole('button', { name: 'Мои тексты' }).count() === 1 && await page.getByText('К списку', { exact: true }).count() === 0, 'Session: «К списку» переименовано в «Мои тексты»');
  await page.getByRole('button', { name: 'Запомнил' }).click();
  await page.locator('textarea').waitFor();
  await page.waitForTimeout(1500);
  const intro = page.getByText('Забыл блок? Открой подсказку ниже');
  r.ok(await intro.count() === 1, 'Session: строка-намёк на первом экране письма');
  r.ok(await page.getByText('Подсказки', { exact: true }).count() === 1, 'Session: постоянная подпись «Подсказки»');
  r.ok(await page.getByRole('dialog').count() === 0, 'строка-намёк не окно');
  const introStyle = await intro.evaluate((e) => ({ anim: getComputedStyle(e).animationName, trans: getComputedStyle(e).transitionDuration, color: getComputedStyle(e).color, dim: getComputedStyle(document.documentElement).getPropertyValue('--text-dim').trim(), tag: e.tagName }));
  r.log('стиль строки:', JSON.stringify(introStyle));
  r.ok(introStyle.anim === 'none' && /^0s/.test(introStyle.trans) && introStyle.tag === 'P', 'строка-намёк без анимации');
  await page.screenshot({ path: `${OUT}/session-intro-360.png` });
  await page.getByRole('button', { name: 'Темы' }).click();
  r.ok(await intro.count() === 0, 'строка-намёк исчезает после первого открытия подсказки');
  r.ok(await page.getByText('Подсказки', { exact: true }).count() === 1, 'подпись «Подсказки» остаётся');
  await page.waitForTimeout(600);
  r.ok((await readSettings(page))?.hintsIntroSeen === true, 'флаг hintsIntroSeen сохранён в настройках');
  await page.reload();
  // Блок после перезагрузки остаётся в письме; если открылось чтение, проходим его.
  await page.locator('textarea').waitFor();
  if (await page.getByRole('button', { name: 'Запомнил' }).count()) await page.getByRole('button', { name: 'Запомнил' }).click();
  await page.waitForTimeout(1500);
  r.ok(await page.getByText('Забыл блок? Открой подсказку ниже').count() === 0 && await page.getByText('Подсказки', { exact: true }).count() === 1, 'после перезагрузки строка-намёк скрыта, подпись на месте');
  await page.screenshot({ path: `${OUT}/session-after-360.png` });

  r.ok(errors.length === 0, 'нет ошибок в консоли ' + JSON.stringify(errors));
  r.ok(net.blocked.length === 0 && [...net.hosts.keys()].every((h) => h === new URL(BASE).origin), 'Journey: ни одного внешнего запроса ' + JSON.stringify(net.blocked));
  await browser.close();
}

async function intro_with_peek() {
  // Подглядывание (ступень 4) тоже считается «открытием подсказки».
  const { browser, page } = await launch();
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Попробовать на примере' }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  await page.getByRole('button', { name: 'Запомнил' }).click();
  await page.locator('textarea').waitFor();
  await page.waitForTimeout(1500);
  r.ok(await page.getByText('Забыл блок? Открой подсказку ниже').count() === 1, 'намёк показан');
  const peek = page.getByRole('button', { name: /Подглядеть/ });
  const box = await peek.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.mouse.up();
  r.ok(await page.getByText('Забыл блок? Открой подсказку ниже').count() === 0, 'подглядывание тоже убирает намёк');
  await browser.close();
}

async function reducedMotion() {
  const { browser, page } = await launch();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Попробовать на примере' }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  await page.getByRole('button', { name: 'Запомнил' }).click();
  await page.locator('textarea').waitFor();
  await page.waitForTimeout(1500);
  r.ok(await page.getByText('Забыл блок? Открой подсказку ниже').count() === 1, 'reduced motion: строка-намёк на месте и без анимации');
  await browser.close();
}

async function resultScreen() {
  const { browser, page } = await launch();
  const doc = makeRichDoc();
  doc.blocks[0].keyphrases = [{ start: 3, end: 15 }];
  doc.blocks[0].hints = { maxLevel: 2, opens: { 1: 1, 2: 1, 3: 0 }, peeks: 1, peekMs: 800 };
  doc.manualEdits = true;
  await seed(page, BASE, [doc], 'result', doc.id);
  await page.getByRole('heading', { name: 'Готово' }).waitFor();
  r.ok(await page.getByRole('button', { name: 'На главную' }).count() === 1 && await page.locator('header').getByRole('button', { name: 'На главную' }).count() === 1, 'Result: отдельной кнопки «На главную» нет, есть только название приложения в шапке с aria-label «На главную»');
  r.ok(await page.getByRole('button', { name: 'Новый текст' }).count() === 1 && await page.getByRole('button', { name: 'Пройти заново' }).count() === 1, 'Result: две кнопки «Новый текст» и «Пройти заново»');
  r.ok(await page.getByText(/Главред|glvrd/i).count() === 0, 'Result: Главреда нет');
  // Иерархия: «Скопировать» основная (залита), «Новый текст» контурная, «Пройти заново» контурная и тише всех.
  const look = (name) => page.getByRole('button', { name }).evaluate((e) => { const c = getComputedStyle(e); return { bg: c.backgroundColor, border: c.borderTopWidth, color: c.color }; });
  const copyB = await look('Скопировать');
  const newB = await look('Новый текст');
  const retryB = await look('Пройти заново');
  r.log('кнопки:', JSON.stringify({ copyB, newB, retryB }));
  r.ok(copyB.bg !== 'rgba(0, 0, 0, 0)' && newB.bg === 'rgba(0, 0, 0, 0)' && retryB.bg === 'rgba(0, 0, 0, 0)', 'Result: «Скопировать» залита, «Новый текст» и «Пройти заново» контурные');
  r.ok(newB.border === '1px' && retryB.border === '1px' && newB.color !== retryB.color, 'Result: у вторичных контур, «Пройти заново» приглушённее');
  const ov = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  r.ok(ov[0] <= ov[1], `Result на 360 px: нет горизонтальной прокрутки (${ov})`);
  await page.screenshot({ path: `${OUT}/result-360.png`, fullPage: true, clip: { x: 0, y: 0, width: 360, height: 1250 } });

  // «Пройти заново»
  await page.getByRole('button', { name: 'Пройти заново' }).click();
  await page.getByRole('button', { name: 'Запомнил' }).waitFor();
  await page.waitForTimeout(700);
  const docs = await readDocs(page);
  const copy = docs.find((d) => d.id !== doc.id);
  r.ok(docs.length === 2 && copy.title === `${doc.title} (ещё раз)`, 'копия создана, старый документ остался, название «… (ещё раз)»');
  r.ok(copy.source === doc.source && copy.blocks.length === doc.blocks.length && copy.manualEdits === true, 'исходник, блоки и ручные правки сохранены');
  r.ok(JSON.stringify(copy.blocks[0].keyphrases) === JSON.stringify(doc.blocks[0].keyphrases), 'ключевые фразы сохранены');
  r.ok(copy.blocks.every((b) => b.userText === '' && b.status === 'pending' && b.typedChars === 0 && b.activeMs === 0 && b.hints.maxLevel === 0 && b.hints.peeks === 0), 'userText пуст, статусы pending, счётчики и подсказки обнулены');
  r.ok(copy.blocks.every((b) => !docs[0].blocks.concat(docs[1].blocks).filter((x) => x !== b).some((x) => x.id === b.id)), 'id блоков новые');
  const old = docs.find((d) => d.id === doc.id);
  r.ok(old.blocks.every((b) => b.status === 'done' && b.userText !== ''), 'старый документ не затронут');
  r.ok(await page.getByText(/^1 из \d+$/).first().isVisible(), 'сессия открыта на первом блоке');

  // Название приложения ведёт на Home (в сессии шапка скрыта: идём через «Мои тексты»)
  await page.getByRole('button', { name: 'Мои тексты' }).click();
  await page.getByRole('heading', { name: 'Вставь текст, который нужно пересказать' }).waitFor();
  r.ok(await page.getByText(/\(ещё раз\)/).count() >= 1, 'в списке виден и оригинал, и копия');

  await browser.close();
}

async function newTextAndCheck() {
  const { browser, page, net, errors } = await launch();
  const doc = makeRichDoc();
  await seed(page, BASE, [doc], 'result', doc.id);
  await page.getByRole('heading', { name: 'Готово' }).waitFor();
  await page.getByRole('button', { name: 'Проверить текст' }).click();
  const summary = page.locator('[data-check-summary]');
  await summary.waitFor();
  const text = (await summary.innerText()).replace(/\s+/g, ' ');
  r.log('сводка проверки:', text);
  r.ok(/Читаемость .*индекс Флеша/.test(text) && /Шаблоны \d+ мест/.test(text) && /Сравнение перенесённых фраз \d+/.test(text), 'панель проверки: сводка из трёх строк');
  await summary.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/check-summary-360.png` });
  // Пустые состояния: шаблонов нет, но есть причина
  const tab = (n) => page.getByRole('tablist', { name: 'Виды проверки' }).getByRole('tab', { name: new RegExp(`^${n}`) });
  await tab('Шаблоны').click();
  const ai = await page.locator('[data-check-panel]').innerText();
  const bare = ai.split('\n').map((l) => l.trim()).filter((l) => /^(—|нет|Нет)\.?$/.test(l));
  r.ok(bare.length === 0, 'вкладка «Шаблоны»: голых прочерков нет');
  await page.getByRole('button', { name: 'Новый текст' }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Новый текст' }).click();
  await page.getByRole('heading', { name: 'Вставь текст, который нужно пересказать' }).waitFor();
  r.ok(await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA'), '«Новый текст»: Home, фокус в поле вставки');
  r.ok(net.blocked.length === 0 && errors.length === 0, 'нет внешних запросов и ошибок ' + JSON.stringify([net.blocked, errors]));
  await browser.close();
}

async function emptyReasons() {
  // Короткий живой текст: каждая пустота объясняет себя.
  const { browser, page, net } = await launch();
  const { makeDoc } = require('./lib.cjs');
  const doc = makeDoc({ id: 'short', sources: ['Вчера я купил хлеб на углу и вернулся домой.', 'Потом пошёл дождь.'], texts: ['Купил хлеб.', 'Пошёл дождь.'] });
  doc.blocks.forEach((b) => (b.typedChars = 0));
  await seed(page, BASE, [doc], 'result', doc.id);
  await page.getByRole('heading', { name: 'Готово' }).waitFor();
  const metrics = (await page.locator('dl').allInnerTexts()).join(' ').replace(/\s+/g, ' ');
  r.log('метрики:', metrics);
  r.ok(/Нужно хотя бы 3 слова/.test(metrics) || /Свои слова \d+%/.test(metrics), 'метрики: у «Свои слова» либо число, либо причина');
  r.ok(/Ничего не набрано и не вставлено, считать нечего/.test(metrics), 'метрики: «Набрано вручную» объясняет прочерк');
  r.ok(/не открывал/.test(metrics) && /не подглядывал/.test(metrics), 'метрики: нулевые подсказки подписаны');
  await page.getByRole('button', { name: 'Проверить текст' }).click();
  const tab = (n) => page.getByRole('tablist', { name: 'Виды проверки' }).getByRole('tab', { name: new RegExp(`^${n}`) });
  await tab('Шаблоны').click();
  const ai = (await page.locator('[data-check-panel]').innerText()).replace(/\s+/g, ' ');
  r.log('Шаблоны:', ai);
  r.ok(/Проверено \d+ слов\S*, 2 предложения, правил \d+: шаблонов не найдено/.test(ai), 'Шаблоны: «Проверено N слов, M предложений, правил R: шаблонов не найдено»');
  r.ok(/Нужно хотя бы 6 предложений, сейчас 2/.test(ai), 'Шаблоны: ритм с порогом и текущим значением');
  r.ok(/Нужно хотя бы 100 значимых слов, сейчас \d+/.test(ai), 'Шаблоны: разнообразие с порогом и текущим значением');
  await page.screenshot({ path: `${OUT}/check-empty-360.png`, fullPage: true });
  r.ok(net.blocked.length === 0, 'нет внешних запросов');
  await browser.close();
}

async function resultWide() {
  const { browser, page } = await launch({ width: 1280, height: 900 });
  await seed(page, BASE, [makeRichDoc()], 'result', 'e2e-rich');
  await page.getByRole('heading', { name: 'Готово' }).waitFor();
  await page.screenshot({ path: `${OUT}/result-1280.png` });
  await browser.close();
}

async function wide() {
  const { browser, page } = await launch({ width: 1280, height: 900 });
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Попробовать на примере' }).click();
  await page.getByRole('group', { name: 'Шаблоны исходника' }).getByRole('button', { name: 'Показать в тексте' }).click();
  await page.screenshot({ path: `${OUT}/split-1280.png` });
  await browser.close();
}

(async () => {
  for (const f of [journey, intro_with_peek, reducedMotion, resultScreen, newTextAndCheck, emptyReasons, wide, resultWide]) {
    console.log(`\n== ${f.name}`);
    try { await f(); } catch (e) { r.ok(false, `${f.name}: ${e.message}`); }
  }
  console.log(r.failed ? `\nПРОВАЛОВ: ${r.failed}` : '\nВсё прошло');
  process.exit(r.failed ? 1 : 0);
})();
