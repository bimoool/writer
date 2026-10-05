/*
 * Режим правки на Result (SPEC §15.5) в Chromium.
 * Запуск: npm run build && npx vite preview --port 4173 --host 127.0.0.1 &
 *         node e2e/edit-mode.cjs <папка для скриншотов> [адрес]
 */
const fs = require('fs');
const { launch, seed, readDocs, makeDoc, reporter, TEXTS } = require('./lib.cjs');

const OUT = process.argv[2] || 'e2e-out';
const BASE = process.argv[3] || 'http://127.0.0.1:4173/';
fs.mkdirSync(OUT, { recursive: true });
const r = reporter();

(async () => {
  const { browser, page, net, errors } = await launch();
  const doc = makeDoc();
  await seed(page, BASE, [doc], 'result', doc.id);
  await page.getByRole('heading', { name: 'Готово' }).waitFor();

  const own = async () => (await page.locator('dl').first().innerText()).replace(/\s+/g, ' ');
  const before = await own();
  const beforeDocs = JSON.stringify((await readDocs(page))[0].blocks.map((b) => b.userText));

  // Режим включается без сетевых запросов.
  const requestsBefore = net.urls.length;
  await page.getByRole('button', { name: 'Править текст' }).click();
  await page.waitForTimeout(500);
  r.ok(net.urls.length === requestsBefore, 'включение режима правки не делает запросов');
  r.ok(await page.getByText(/Орфографию проверяет твой браузер/).count() === 1, 'пояснение про браузерную орфографию');
  r.ok(await page.locator('textarea').count() === 0, 'пока блок не выбран, полей нет');
  await page.screenshot({ path: `${OUT}/edit-start-360.png` });

  // Выбираем блок 4 (индекс 3). Режим «вкладок» на 360: открыта «Твой текст».
  await page.getByRole('button', { name: 'Править блок 4' }).click();
  const ta = page.locator('textarea');
  await ta.waitFor();
  r.ok(await ta.count() === 1, 'редактируемое поле одно, остальные ячейки обычный текст');
  const attrs = await ta.evaluate((el) => ({ spellcheck: el.getAttribute('spellcheck'), lang: el.getAttribute('lang'), name: el.getAttribute('name'), autocomplete: el.getAttribute('autocomplete'), autocapitalize: el.getAttribute('autocapitalize'), active: document.activeElement === el }));
  r.log('атрибуты поля правки:', JSON.stringify(attrs));
  r.ok(attrs.spellcheck === 'true' && attrs.lang === 'ru' && attrs.name === 'result-edit' && attrs.autocomplete === 'off', 'spellcheck=true, lang=ru, name=result-edit, autocomplete=off');
  r.ok(attrs.active, 'фокус в поле');

  // Блокировка вставки (allowPaste выключен в настройках).
  const pasteResult = await ta.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', ' ВСТАВЛЕННОЕ');
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    const bi = new InputEvent('beforeinput', { inputType: 'insertFromPaste', data: 'x', bubbles: true, cancelable: true });
    el.dispatchEvent(bi);
    return { pasteCancelled: ev.defaultPrevented, beforeInputCancelled: bi.defaultPrevented, value: el.value };
  });
  r.ok(pasteResult.pasteCancelled && pasteResult.beforeInputCancelled, 'paste и beforeinput(insertFromPaste) отменены');
  r.ok(!pasteResult.value.includes('ВСТАВЛЕННОЕ'), 'вставленный текст в поле не попал');
  r.ok(await page.getByText('Вставка отключена').count() === 1, 'пояснение о блокировке вставки');

  // Правка: заменяем текст блока набором. Метрики на экране не меняются, пока правим.
  await ta.press('Control+A');
  await page.keyboard.type('Сам придумал этот способ: двадцать пять минут работы и короткий отдых.');
  await page.waitForTimeout(400);
  r.ok((await own()) === before, 'метрики не пересчитываются, пока включён режим правки');
  await page.screenshot({ path: `${OUT}/edit-field-360.png` });

  // Пустой блок: сообщение, Esc возвращает прежний текст.
  await ta.press('Control+A');
  await ta.press('Backspace');
  await page.waitForTimeout(200);
  r.ok(await page.getByText(/Блок не может быть пустым/).count() === 1, 'сообщение о пустом блоке');
  let docs = await readDocs(page);
  r.ok(docs[0].blocks[3].userText.startsWith('Сам придумал'), 'пустое значение в хранилище не записано');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  r.ok(await page.locator('textarea').count() === 0, 'Esc выходит из режима правки');
  r.ok(await page.getByText(/вернулся прежний текст/).count() === 1, 'сообщение «вернулся прежний текст»');
  docs = await readDocs(page);
  r.ok(docs[0].blocks[3].userText === TEXTS[3], 'прежний текст возвращён в хранилище');

  // Нормальная правка через кнопку «Готово».
  await page.getByRole('button', { name: 'Править текст' }).click();
  await page.getByRole('button', { name: 'Править блок 4' }).click();
  await page.locator('textarea').press('Control+A');
  await page.keyboard.type('Сам придумал этот способ: двадцать пять минут работы и короткий отдых.');
  await page.getByRole('button', { name: 'Готово' }).click();
  await page.waitForTimeout(500);
  r.ok(await page.locator('textarea').count() === 0, '«Готово» выходит из режима');
  r.ok(await page.evaluate(() => document.activeElement?.textContent === 'Править текст'), 'фокус вернулся на «Править текст»');
  const after = await own();
  r.log('метрики до:', before, '\nметрики после:', after);
  r.ok(after !== before, 'после выхода метрики пересчитаны');
  await page.waitForTimeout(1200);
  docs = await readDocs(page);
  const b3 = docs[0].blocks[3];
  r.ok(b3.userText.startsWith('Сам придумал'), 'правка сохранена автосохранением');
  r.ok(b3.typedChars > 100 && b3.pastedChars === 0, `typedChars вырос (${b3.typedChars}), pastedChars не вырос`);
  await page.reload();
  await page.getByRole('heading', { name: 'Готово' }).waitFor();
  r.ok((await page.locator('main').innerText()).includes('Сам придумал этот способ'), 'после перезагрузки правка на месте');

  // Подсветка проверки не показывается в режиме правки.
  await page.getByRole('button', { name: 'Проверить текст' }).click();
  await page.waitForTimeout(300);
  r.ok(await page.locator('.mark').count() > 0, 'подсветка проверки есть');
  await page.getByRole('button', { name: 'Править текст' }).click();
  r.ok(await page.locator('.mark').count() === 0, 'в режиме правки подсветка скрыта');
  await page.getByRole('button', { name: 'Готово' }).click();
  r.ok(await page.locator('.mark').count() > 0, 'после выхода подсветка вернулась');

  // lang и атрибуты поля письма в Session.
  const writing = makeDoc({ id: 'e2e-writing', texts: [] });
  await seed(page, BASE, [writing], 'session', writing.id);
  await page.waitForSelector('textarea[name="retelling-text"]', { state: 'attached' });
  const sess = await page.locator('textarea[name="retelling-text"]').evaluate((el) => ({ lang: el.getAttribute('lang'), spellcheck: el.getAttribute('spellcheck') }));
  r.ok(sess.lang === 'ru' && sess.spellcheck === 'true', `поле письма в Session: lang=${sess.lang}, spellcheck=${sess.spellcheck}`);

  r.log('\nХОСТЫ:');
  for (const [h, n] of net.hosts) r.log(' ', h, n);
  r.log('заблокировано внешних запросов:', net.blocked.length);
  r.ok(net.blocked.length === 0 && [...net.hosts.keys()].every((h) => h === new URL(BASE).origin), 'запросов не к своему хосту нет');
  r.ok(errors.length === 0, 'нет ошибок в консоли ' + JSON.stringify(errors));
  await browser.close();
  process.exit(r.failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
