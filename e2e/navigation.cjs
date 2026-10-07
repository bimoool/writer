/*
 * Навигация и «как начать сначала» (SPEC §3.1, §3.2, §3.3, §9, §11) в Chromium: с Split, Session, Result, Result в режиме
 * правки и из панели настроек «начать новый текст» не больше 2 нажатий, «пройти заново» не больше 2, «на главную» не больше 1.
 * Данные документов при этом сохраняются. Скриншоты 360 px, тёмная тема.
 * Запуск: npm run build && npx vite preview --port 4173 --host 127.0.0.1 &
 *         PLAYWRIGHT_PATH=<путь к playwright> node e2e/navigation.cjs <папка для скриншотов> [адрес]
 */
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { seed, readDocs, makeDoc, reporter } = require('./lib.cjs');

const OUT = process.argv[2] || 'e2e-out';
const BASE = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'http://127.0.0.1:4173/';
fs.mkdirSync(OUT, { recursive: true });
const r = reporter();

const SOURCES = [
  'Первая мысль про реку. Вторая мысль про гору. Третья мысль про лес.',
  'Четвёртая мысль про озеро и его берега. Пятая мысль про поле и ветер.',
  'Шестая мысль про город и мост через реку.',
];
const done = () => makeDoc({ id: 'nav-done', sources: SOURCES, texts: ['мой первый', 'мой второй', 'мой третий'], status: 'done' });
/** Документ в работе: первый блок написан, второй ждёт. */
const partial = () => {
  const d = makeDoc({ id: 'nav-part', sources: SOURCES, texts: ['мой первый'], status: 'done' });
  d.currentIndex = 1;
  d.blocks.forEach((b, i) => {
    b.status = i === 0 ? 'done' : 'pending';
    b.userText = i === 0 ? 'мой первый' : '';
    if (i > 0) { b.typedChars = 0; b.activeMs = 0; }
  });
  delete d.finishedAt;
  return d;
};
const fresh = () => makeDoc({ id: 'nav-fresh', sources: SOURCES, texts: [], status: 'pending' });

async function open({ touch = false, height = 740 } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 360, height }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch, colorScheme: 'dark' });
  await ctx.route((u) => u.protocol.startsWith('http') && u.hostname !== '127.0.0.1', (route) => route.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return { browser, page, errors };
}

/** Считает нажатия: каждое действие пользователя идёт через click(). */
function counter(page) {
  let n = 0;
  return {
    get n() { return n; },
    async click(locator) { n++; await locator.click(); await page.waitForTimeout(150); },
  };
}

const gearLabel = 'Настройки';
const settingsOpen = (page) => page.getByRole('dialog', { name: 'Настройки' });
const nav = (page) => settingsOpen(page).locator('[data-settings-nav]');
const homeVisible = (page) => page.getByRole('heading', { name: 'Вставь текст, который нужно пересказать' }).isVisible();
const docs = async (page) => (await readDocs(page)).sort((a, b) => a.id.localeCompare(b.id));
const flush = (page) => page.waitForTimeout(900);

async function scenario(name, { screen, seedDocs, id, touch = false, height = 740, theme = 'dark' }, body) {
  const { browser, page, errors } = await open({ touch, height });
  const ok = (cond, msg) => r.ok(cond, `${name}: ${msg}`);
  try {
    await seed(page, BASE, seedDocs, screen, id, theme);
    await page.waitForTimeout(500);
    await body(page, ok);
  } catch (e) {
    ok(false, `исключение ${String(e).split('\n')[0]}`);
  } finally {
    if (errors.length) ok(false, `ошибки страницы ${errors.join('; ')}`);
    await browser.close();
  }
}

/** Содержимое блоков то же. Время работы (activeMs) при выходе из сессии дописывается честно, поэтому его не сравниваем. */
const content = (d) => JSON.stringify(d.blocks.map((b) => [b.id, b.sourceText, b.userText, b.status, b.keyphrases]));
const sameDocs = (a, b) => a.filter((d) => b.some((x) => x.id === d.id)).every((d) => content(d) === content(b.find((x) => x.id === d.id)));

(async () => {
  // --- Split -----------------------------------------------------------------------------------
  await scenario('Split', { screen: 'split', seedDocs: [fresh()], id: 'nav-fresh' }, async (page, ok) => {
    const header = page.locator('header').first();
    ok((await header.getByRole('button', { name: 'На главную' }).textContent()).trim() === 'Своими словами', 'название приложения в шапке с aria-label «На главную»');
    ok((await header.getByText('Разбивка', { exact: true }).count()) === 1, 'в шапке виден заголовок «Разбивка»');
    ok((await page.getByRole('button', { name: /Мои тексты/ }).count()) === 1, '«← Мои тексты» вместо «← Назад»');
    ok((await page.getByRole('button', { name: /Назад/ }).count()) === 0, '«Назад» убрано');
    // на главную: 1
    let c = counter(page);
    await c.click(page.getByRole('button', { name: 'На главную' }));
    ok(c.n <= 1 && (await homeVisible(page)), `на главную: ${c.n} нажатие по названию`);
  });
  await scenario('Split', { screen: 'split', seedDocs: [fresh()], id: 'nav-fresh' }, async (page, ok) => {
    const before = await docs(page);
    const c = counter(page);
    await c.click(page.getByRole('button', { name: 'Новый текст', exact: true }));
    ok(c.n <= 1 && (await homeVisible(page)), `новый текст: ${c.n} нажатие`);
    ok(await page.locator('textarea').evaluate((el) => el === document.activeElement), 'фокус в поле вставки');
    ok(sameDocs(await docs(page), before) && (await docs(page)).length === before.length, 'документ сохранён');
  });
  await scenario('Split → панель', { screen: 'split', seedDocs: [fresh()], id: 'nav-fresh' }, async (page, ok) => {
    const before = await docs(page);
    const c = counter(page);
    await c.click(page.getByRole('button', { name: gearLabel }));
    ok((await nav(page).getByRole('button').allInnerTexts()).join('|') === 'Мои тексты|Новый текст|Пройти заново', 'в панели блок «Навигация»: Мои тексты, Новый текст, Пройти заново');
    await c.click(nav(page).getByRole('button', { name: 'Пройти заново' }));
    await page.getByText(/^1 из 3/).first().waitFor({ timeout: 4000 });
    ok(c.n <= 2, `пройти заново из панели: ${c.n} нажатия, открылась сессия на первом блоке`);
    ok((await settingsOpen(page).count()) === 0, 'панель закрылась');
    await flush(page);
    const after = await docs(page);
    ok(after.length === before.length + 1 && sameDocs(after, before), 'создана копия, исходный документ не изменён');
  });

  // --- Session ---------------------------------------------------------------------------------
  await scenario('Session', { screen: 'session', seedDocs: [partial()], id: 'nav-part' }, async (page, ok) => {
    ok((await page.getByText('Письмо', { exact: true }).count()) >= 1, 'виден заголовок «Письмо»');
    const topBar = page.locator('.session-top');
    ok((await topBar.getByRole('button', { name: 'Мои тексты' }).count()) === 1, 'в верхней панели «Мои тексты»');
    ok((await topBar.getByRole('button', { name: 'Начать заново' }).count()) === 1, 'и «Начать заново»');
    const before = await docs(page);
    const c = counter(page);
    await c.click(topBar.getByRole('button', { name: 'Начать заново' }));
    const dlg = page.getByRole('dialog', { name: 'Начать заново' });
    ok((await dlg.innerText()).includes('Будет создана копия этого текста с пустым листом, текущий не изменится. Создать?'), 'экранное подтверждение с нужным текстом (не window.confirm)');
    ok((await dlg.getByRole('button').allInnerTexts()).join('|') === 'Создать копию|Отмена', 'кнопки «Создать копию» и «Отмена»');
    ok(await dlg.getByRole('button', { name: 'Отмена' }).evaluate((el) => el === document.activeElement), 'фокус сразу на «Отмена»');
    await page.screenshot({ path: `${OUT}/session-restart-menu-360.png` });
    // Esc отменяет и ничего не создаёт
    await page.keyboard.press('Escape');
    await flush(page);
    ok((await dlg.count()) === 0 && (await docs(page)).length === before.length, 'Esc отменяет, копии нет');
    c.n = 0;
    const c2 = counter(page);
    await c2.click(topBar.getByRole('button', { name: 'Начать заново' }));
    await c2.click(dlg.getByRole('button', { name: 'Создать копию' }));
    await page.getByText(/^1 из 3/).first().waitFor({ timeout: 4000 });
    ok(c2.n <= 2, `начать заново: ${c2.n} нажатия`);
    await flush(page);
    const after = await docs(page);
    ok(after.length === before.length + 1, 'создана копия');
    ok(sameDocs(after, before) && JSON.stringify(after.find((d) => d.id === 'nav-part').blocks[0].userText) === '"мой первый"', 'исходный документ не изменён (текст первого блока на месте)');
    const copy = after.find((d) => d.id !== 'nav-part');
    ok(copy.blocks.every((b) => b.userText === '' && b.status !== 'done'), 'копия с пустым листом');
  });
  await scenario('Session', { screen: 'session', seedDocs: [partial()], id: 'nav-part' }, async (page, ok) => {
    const c = counter(page);
    await c.click(page.locator('.session-top').getByRole('button', { name: 'Мои тексты' }));
    ok(c.n <= 1 && (await homeVisible(page)), `на главную из сессии: ${c.n} нажатие`);
  });
  await scenario('Session → панель', { screen: 'session', seedDocs: [partial()], id: 'nav-part' }, async (page, ok) => {
    const before = await docs(page);
    const c = counter(page);
    await c.click(page.getByRole('button', { name: gearLabel }));
    ok((await nav(page).count()) === 1, 'в панели настроек в сессии есть блок «Навигация»');
    await c.click(nav(page).getByRole('button', { name: 'Новый текст' }));
    ok(c.n <= 2 && (await homeVisible(page)), `новый текст из сессии через панель: ${c.n} нажатия`);
    await flush(page);
    ok(sameDocs(await docs(page), before) && (await docs(page)).length === before.length, 'данные сохранены');
  });
  // телефон с открытой клавиатурой: верхняя панель скрыта, настройки остаются
  await scenario('Session, клавиатура', { screen: 'session', seedDocs: [partial()], id: 'nav-part', touch: true, height: 400 }, async (page, ok) => {
    ok(!(await page.locator('.session-top').isVisible()), 'на низком экране верхняя панель скрыта');
    const gear = page.getByRole('button', { name: gearLabel });
    ok(await gear.isVisible(), 'значок настроек виден (чтение)');
    await page.getByRole('button', { name: 'Запомнил' }).tap();
    await page.locator('textarea').waitFor({ timeout: 5000 });
    await page.waitForTimeout(1600);
    ok(await gear.isVisible(), 'значок настроек виден (письмо, клавиатура открыта)');
    await gear.tap();
    ok((await nav(page).count()) === 1, 'панель с блоком «Навигация» открылась');
    await nav(page).getByRole('button', { name: 'Мои тексты' }).tap();
    await page.waitForTimeout(200);
    ok(await homeVisible(page), 'из панели «Мои тексты» ведёт на главную (2 касания)');
  });

  // --- Result ----------------------------------------------------------------------------------
  await scenario('Result', { screen: 'result', seedDocs: [done()], id: 'nav-done' }, async (page, ok) => {
    const header = page.locator('header').first();
    ok((await header.getByText('Итог', { exact: true }).count()) === 1, 'в шапке виден заголовок «Итог»');
    const before = await docs(page);
    let c = counter(page);
    await c.click(page.getByRole('button', { name: 'Пройти заново' }));
    await page.getByText(/^1 из 3/).first().waitFor({ timeout: 4000 });
    ok(c.n <= 2, `пройти заново: ${c.n} нажатие`);
    await flush(page);
    const after = await docs(page);
    ok(after.length === before.length + 1 && sameDocs(after, before), 'копия создана, старый документ не изменён');
  });
  await scenario('Result', { screen: 'result', seedDocs: [done()], id: 'nav-done' }, async (page, ok) => {
    const c = counter(page);
    await c.click(page.getByRole('button', { name: 'На главную' }));
    ok(c.n <= 1 && (await homeVisible(page)), `на главную: ${c.n} нажатие`);
  });
  await scenario('Result', { screen: 'result', seedDocs: [done()], id: 'nav-done' }, async (page, ok) => {
    const c = counter(page);
    await c.click(page.getByRole('button', { name: 'Новый текст', exact: true }));
    ok(c.n <= 1 && (await homeVisible(page)), `новый текст: ${c.n} нажатие`);
  });

  // --- Result, режим правки --------------------------------------------------------------------
  const editScenario = (name, fn) => scenario(`Result, правка: ${name}`, { screen: 'result', seedDocs: [done()], id: 'nav-done' }, async (page, ok) => {
    await page.getByRole('button', { name: 'Править текст' }).click();
    await page.waitForTimeout(200);
    await fn(page, ok);
  });
  await editScenario('плашка', async (page, ok) => {
    const banner = page.getByRole('region', { name: 'Режим правки' });
    ok(await banner.isVisible(), 'вверху плашка «Режим правки»');
    ok((await banner.getByRole('button').allInnerTexts()).join('|') === 'Готово|Мои тексты', 'в плашке «Готово» и «Мои тексты»');
    ok((await page.locator('header').first().getByText('Правка', { exact: true }).count()) === 1, 'в шапке заголовок «Правка»');
    for (const name of ['Скопировать', 'Новый текст', 'Пройти заново']) {
      ok(await page.getByRole('button', { name, exact: true }).isVisible(), `«${name}» остаётся видимой в режиме правки`);
    }
    await page.evaluate(() => scrollTo(0, 600));
    await page.waitForTimeout(200);
    ok((await banner.boundingBox()).y <= 1, 'плашка закреплена при прокрутке');
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${OUT}/result-edit-banner-360.png` });
  });
  await editScenario('«Готово» без потери изменений', async (page, ok) => {
    const block = page.getByRole('button', { name: /Править блок 1/ }).first();
    await block.click();
    const field = page.locator('textarea').first();
    await field.waitFor();
    await field.press('End');
    await page.keyboard.type(' дополнено');
    await page.waitForTimeout(900);
    const c = counter(page);
    await c.click(page.getByRole('region', { name: 'Режим правки' }).getByRole('button', { name: 'Готово' }));
    ok(c.n === 1 && (await page.locator('textarea').count()) === 0, '«Готово» выходит из режима одним нажатием');
    await flush(page);
    ok((await docs(page))[0].blocks[0].userText.endsWith('дополнено'), 'правка сохранена');
  });
  await editScenario('пустая правка', async (page, ok) => {
    await page.getByRole('button', { name: /Править блок 1/ }).first().click();
    const field = page.locator('textarea').first();
    await field.waitFor();
    await field.fill('');
    await page.getByRole('region', { name: 'Режим правки' }).getByRole('button', { name: 'Готово' }).click();
    await page.waitForTimeout(300);
    ok((await page.getByText('Блок остался пустым, поэтому вернулся прежний текст.').count()) === 1, '«Готово» на пустой правке возвращает прежний текст с сообщением');
    ok((await docs(page))[0].blocks[0].userText === 'мой первый', 'текст блока вернулся');
  });
  await editScenario('на главную', async (page, ok) => {
    const c = counter(page);
    await c.click(page.getByRole('region', { name: 'Режим правки' }).getByRole('button', { name: 'Мои тексты' }));
    ok(c.n <= 1 && (await homeVisible(page)), `на главную из правки: ${c.n} нажатие`);
  });
  await editScenario('новый текст', async (page, ok) => {
    const c = counter(page);
    await c.click(page.getByRole('button', { name: 'Новый текст', exact: true }));
    ok(c.n <= 1 && (await homeVisible(page)), `новый текст из правки: ${c.n} нажатие`);
  });
  await editScenario('пройти заново', async (page, ok) => {
    const before = await docs(page);
    const c = counter(page);
    await c.click(page.getByRole('button', { name: 'Пройти заново' }));
    await page.getByText(/^1 из 3/).first().waitFor({ timeout: 4000 });
    ok(c.n <= 2, `пройти заново из правки: ${c.n} нажатие`);
    await flush(page);
    const after = await docs(page);
    ok(after.length === before.length + 1 && sameDocs(after, before), 'данные сохранены');
  });
  await scenario('Result → панель', { screen: 'result', seedDocs: [done()], id: 'nav-done' }, async (page, ok) => {
    const c = counter(page);
    await c.click(page.getByRole('button', { name: gearLabel }));
    await c.click(nav(page).getByRole('button', { name: 'Пройти заново' }));
    await page.getByText(/^1 из 3/).first().waitFor({ timeout: 4000 });
    ok(c.n <= 2, `пройти заново из панели: ${c.n} нажатия`);
  });
  await scenario('Home', { screen: 'home', seedDocs: [done()], id: 'nav-done' }, async (page, ok) => {
    ok((await page.locator('header').first().getByText('Мои тексты', { exact: true }).count()) === 1, 'в шапке Home заголовок «Мои тексты»');
    await page.getByRole('button', { name: gearLabel }).click();
    ok((await nav(page).count()) === 0, 'на Home блока «Навигация» в панели нет');
  });

  // --- скриншот панели с «Навигацией» в сессии, 360 px, тёмная тема ------------------------------
  await scenario('Скриншот панели', { screen: 'session', seedDocs: [partial()], id: 'nav-part', touch: true }, async (page, ok) => {
    await page.getByRole('button', { name: 'Запомнил' }).tap();
    await page.locator('textarea').waitFor({ timeout: 5000 });
    await page.waitForTimeout(1600);
    await page.getByRole('button', { name: gearLabel }).tap();
    await nav(page).waitFor();
    await page.screenshot({ path: `${OUT}/settings-nav-session-360.png` });
    const box = await settingsOpen(page).boundingBox();
    ok(box.x >= 0 && box.x + box.width <= 360, `панель помещается в 360 px (x=${box.x}, w=${box.width})`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= 360), 'горизонтальной прокрутки нет');
  });

  console.log(r.failed ? `\nПровалено проверок: ${r.failed}` : '\nВсе проверки прошли');
  process.exit(r.failed ? 1 : 0);
})();
