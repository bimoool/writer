/*
 * Проверка текста (SPEC §15) в Chromium: вкладки, подсветка, карточки, метрики и хранилище не меняются,
 * сеть перехвачена (кроме 127.0.0.1 всё блокируется и считается провалом).
 * Запуск: npm run build && npx vite preview --port 4173 --host 127.0.0.1 &
 *         node e2e/check-text.cjs <папка для скриншотов> [адрес] [--shots]
 * С --shots снимает скриншоты каждой вкладки и режима правки в трёх темах на 360 и 1280 px.
 */
const fs = require('fs');
const { launch, seed, readDocs, makeDoc, makeRichDoc, reporter } = require('./lib.cjs');

const OUT = process.argv[2] || 'e2e-out';
const BASE = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'http://127.0.0.1:4173/';
const SHOTS = process.argv.includes('--shots');
fs.mkdirSync(OUT, { recursive: true });
const r = reporter();

const metricsText = async (page) => (await page.locator('dl').first().innerText()).replace(/\s+/g, ' ');
const tabs = (page) => page.getByRole('tablist', { name: 'Виды проверки' });
const tab = (page, name) => tabs(page).getByRole('tab', { name: new RegExp(`^${name}`) });

async function scenario() {
  const { browser, page, net, errors } = await launch();
  const doc = makeRichDoc();
  await seed(page, BASE, [doc], 'result', doc.id);
  await page.getByRole('heading', { name: 'Готово' }).waitFor();
  const urlsBefore = net.urls.length;

  const metricsBefore = await metricsText(page);
  const storedBefore = JSON.stringify(await readDocs(page));
  r.ok(await page.locator('.mark').count() === 0, 'до нажатия «Проверить текст» подсветки нет');
  r.ok(await tabs(page).count() === 0, 'до нажатия вкладок нет');

  await page.getByRole('button', { name: 'Проверить текст' }).click();
  const names = await tabs(page).getByRole('tab').allInnerTexts();
  r.log('вкладки:', JSON.stringify(names));
  r.ok(names.length === 3 && /^Читаемость/.test(names[0]) && /^Шаблоны/.test(names[1]) && /^Сравнение/.test(names[2]), 'три вкладки: Читаемость, Шаблоны, Сравнение');
  r.ok(!names.some((n) => /Орфография/.test(n)), 'вкладки «Орфография» нет');
  r.ok(net.urls.length === urlsBefore || net.urls.slice(urlsBefore).every((u) => u.startsWith(BASE)), 'проверка не делает запросов наружу');
  r.ok(!net.urls.slice(urlsBefore).some((u) => /\.dic|\.aff|spell|dictionary/i.test(u)), 'никакого словаря не запрашивается');

  // Читаемость
  const panel = page.locator('[data-check-panel]');
  r.log('Читаемость:', JSON.stringify((await panel.innerText()).slice(0, 300)));
  r.ok(/Индекс Флеша/.test(await panel.innerText()), 'читаемость: индекс Флеша показан');
  if (SHOTS) await shot(page, 'read');

  // Шаблоны
  await tab(page, 'Шаблоны').click();
  const ai = await panel.innerText();
  r.ok(/Шаблонные обороты/.test(ai) && /Словесный мусор/.test(ai) && /Ритм предложений/.test(ai) && /Одинаковые начала/.test(ai) && /Разнообразие слов/.test(ai), 'шаблоны: все пять разделов');
  r.ok(/подсказки, а не приговор/i.test(ai), 'шаблоны: подаются как подсказки');
  r.ok(!/(?<![А-Яа-яЁё])ИИ(?![А-Яа-яЁё])|нейросет|вероятност/.test(ai), 'в панели нет слов «ИИ», «нейросеть», «вероятность»');
  r.ok(await page.locator('.mark-ai').count() > 0 && await page.locator('.mark-junk').count() > 0, 'в тексте есть подсветка двух цветов: шаблоны и мусор');
  r.log('Шаблоны:', JSON.stringify(ai.slice(0, 700)));
  if (SHOTS) await shot(page, 'ai');

  // Сравнение
  await tab(page, 'Сравнение').click();
  const cmp = await panel.innerText();
  r.log('Сравнение:', JSON.stringify(cmp.slice(0, 700)));
  r.ok(/Перенесённые фразы/.test(cmp) && /Шаблоны, перешедшие из исходника/.test(cmp) && /Шаблоны исходника, которых нет в твоём тексте/.test(cmp), 'сравнение: три раздела');
  r.ok(await page.locator('.mark-carry').count() > 0, 'в тексте подсвечены перенесённые места');
  r.ok(await page.getByText(/Совпадений с исходником: \d+/).count() >= 1 && await page.getByText(/Совпадений с исходником: \d+/).count() <= 3, 'до трёх блоков отмечено значком');
  if (SHOTS) await shot(page, 'cmp');

  // Карточка с блоком исходника, клавиатура и возврат фокуса.
  const phraseItem = page.locator('[data-list-item]', { hasText: /слов\S* подряд как в исходнике/ }).first();
  await phraseItem.focus();
  await page.keyboard.press('Enter');
  const card = page.getByRole('dialog');
  await card.waitFor();
  const cardText = await card.innerText();
  r.log('карточка:', JSON.stringify(cardText));
  r.ok(/Так в исходнике/.test(cardText), 'карточка перенесённой фразы показывает блок исходника');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  r.ok(await card.count() === 0, 'Esc закрывает карточку');
  r.ok(await page.evaluate(() => document.activeElement?.hasAttribute('data-list-item')), 'фокус вернулся на строку списка, откуда открыли');
  // С метки в тексте
  await page.locator('.mark-carry').first().focus();
  await page.keyboard.press('Enter');
  await card.waitFor();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  r.ok(await page.evaluate(() => document.activeElement?.classList.contains('mark')), 'фокус вернулся на метку в тексте');
  // С кнопки списка
  const item = page.locator('[data-list-item]').first();
  await item.focus();
  await page.keyboard.press('Enter');
  await card.waitFor();
  await page.getByRole('button', { name: 'Закрыть' }).click();
  await page.waitForTimeout(150);
  r.ok(await page.evaluate(() => document.activeElement?.hasAttribute('data-list-item')), 'фокус вернулся на строку списка');

  // Подсветка отключается общей кнопкой
  await page.getByRole('button', { name: 'Скрыть подсветку' }).click();
  r.ok(await page.locator('.mark').count() === 0, 'кнопка «Скрыть подсветку» убирает подсветку на всех вкладках');
  await tab(page, 'Шаблоны').click();
  r.ok(await page.locator('.mark').count() === 0, 'и на другой вкладке она остаётся скрытой');
  await page.getByRole('button', { name: 'Показать подсветку' }).click();

  // Метрики и хранилище не изменились
  await page.waitForTimeout(1200);
  r.ok((await metricsText(page)) === metricsBefore, 'метрики и «Свои слова» после проверки те же');
  r.ok(JSON.stringify(await readDocs(page)) === storedBefore, 'в хранилище текст не изменился');
  const overflow = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  r.ok(overflow[0] <= overflow[1], `на 360 px нет горизонтальной прокрутки (${overflow})`);

  // Сеть: ни одного внешнего хоста. Любое обращение наружу перехвачено и оборвано, и такая попытка сама по себе провал.
  r.ok(!(await page.getByRole('link', { name: /Главред/ }).count()) && !(await page.getByText(/Главред|glvrd/i).count()), 'кнопки и упоминаний Главреда на экране нет');
  r.ok(await page.locator('a[href^="http"]').count() === 0, 'на экране нет внешних ссылок');

  r.log('\nХОСТЫ (все запросы контекста, включая новую вкладку):');
  for (const [h, n] of net.hosts) r.log(' ', h, n);
  r.log('попыток обратиться наружу:', JSON.stringify(net.blocked));
  r.ok(net.blocked.length === 0, 'ни одной попытки обратиться наружу (любой внешний хост, включая glvrd.ru, был бы перехвачен и оборван)');
  r.ok([...net.hosts.keys()].every((h) => h === new URL(BASE).origin), 'все запросы только к самому приложению');
  r.ok(errors.length === 0, 'нет ошибок в консоли ' + JSON.stringify(errors));
  await browser.close();
}

async function noSource() {
  const { browser, page } = await launch();
  const doc = makeDoc({ id: 'nosrc', sources: ['', '', ''], texts: ['Мой текст про планы на день.', 'Ещё один блок про дела.', 'И третий блок.'] });
  await seed(page, BASE, [doc], 'result', doc.id);
  await page.getByRole('heading', { name: 'Готово' }).waitFor();
  await page.getByRole('button', { name: 'Проверить текст' }).click();
  await tab(page, 'Сравнение').click();
  r.ok(await page.locator('[data-check-panel]').getByText('сравнивать не с чем').count() === 1, 'пустой исходник: вкладка так и говорит и ничего не считает');
  await browser.close();
}

/** Снимок элемента, не выше maxHeight CSS-пикселей от его верха. */
async function clipShot(page, locator, file, maxHeight) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const top = box.y + (await page.evaluate(() => scrollY));
  await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y: top, width: page.viewportSize().width, height: Math.min(box.height, maxHeight) } });
}

async function shot() {}

/** Скриншоты: тема × ширина × вкладка и режим правки. */
async function screenshots() {
  for (const theme of ['dark', 'light', 'sepia']) {
    for (const [label, width, height] of [['360', 360, 740], ['1280', 1280, 900]]) {
      const { browser, page } = await launch({ width, height, scheme: theme === 'dark' ? 'dark' : 'light' });
      const doc = makeRichDoc();
      await seed(page, BASE, [doc], 'result', doc.id, theme);
      await page.getByRole('heading', { name: 'Готово' }).waitFor();
      await page.getByRole('button', { name: 'Проверить текст' }).click();
      for (const [name, file] of [['Читаемость', 'read'], ['Шаблоны', 'ai'], ['Сравнение', 'cmp']]) {
        await tab(page, name).click();
        await page.waitForTimeout(150);
        await clipShot(page, page.locator('section', { has: page.locator('[data-check-panel]') }), `${OUT}/${theme}-${label}-${file}-panel.png`, 1500);
        await clipShot(page, page.locator('section[aria-label="Сравнение с исходником"]'), `${OUT}/${theme}-${label}-${file}-text.png`, 1300);
      }
      // карточка (перенесённая фраза с блоком исходника)
      await page.locator('[data-list-item]', { hasText: /слов\S* подряд как в исходнике/ }).first().click();
      await page.getByRole('dialog').waitFor();
      await page.screenshot({ path: `${OUT}/${theme}-${label}-card.png` });
      await page.keyboard.press('Escape');
      // режим правки
      await page.getByRole('button', { name: 'Править текст' }).click();
      await page.getByRole('button', { name: 'Править блок 2' }).click();
      await page.locator('textarea').waitFor();
      await clipShot(page, page.locator('section[aria-label="Сравнение с исходником"]'), `${OUT}/${theme}-${label}-edit-text.png`, 900);
      await page.screenshot({ path: `${OUT}/${theme}-${label}-edit-top.png` });
      await browser.close();
    }
  }
}

(async () => {
  await scenario();
  await noSource();
  if (SHOTS) await screenshots();
  process.exit(r.failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
