/*
 * Режим разреза на Split (SPEC §3.2) в Chromium: мышь, касание, клавиатура.
 * Один общий режим на экран: кнопка «Режим разреза» / «Готово», во всех блоках сразу все точки разреза.
 * Запуск: npm run build && npx vite preview --port 4173 --host 127.0.0.1 &
 *         PLAYWRIGHT_PATH=<путь к playwright> node e2e/split-cut.cjs <папка для скриншотов> [адрес] [режимы через запятую: mouse,touch,keyboard]
 * Код выхода не нулевой, если хоть одна проверка упала. Скриншоты: 360 px, тёмная тема.
 */
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { readDocs, makeDoc, seed, reporter } = require('./lib.cjs');

const OUT = process.argv[2] || 'e2e-out';
const BASE = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'http://127.0.0.1:4173/';
const MODES = (process.argv[4] || 'mouse,touch,keyboard').split(',');
fs.mkdirSync(OUT, { recursive: true });
const r = reporter();

/** 8 абзацев по 2–3 предложения: каждый становится отдельным блоком. Точек разреза: 2+1+1+1+2+1+1+1 = 10. */
const SENTENCES = [3, 2, 2, 2, 3, 2, 2, 2];
const TOPICS = ['река', 'гора', 'озеро', 'лес', 'поле', 'город', 'мост', 'остров'];
const SOURCE = SENTENCES.map((n, i) =>
  Array.from({ length: n }, (_, j) => `Абзац ${i + 1} предложение ${j + 1} про ${TOPICS[i]} и её характер в разные времена.`).join(' '),
).join('\n\n');
const CUT_POINTS = SENTENCES.reduce((s, n) => s + n - 1, 0);

const HINT = 'Нажми на кнопку между предложениями, чтобы разрезать блок';
const INTRO = 'Режем по границам предложений. Исправить можно кнопкой «Отменить действие»';

/** Документ со скриншота пользователя: 3 блока, первый «В современном мире…» из двух предложений. */
const SHOT_SOURCES = [
  'В современном мире умение эффективно управлять своим временем становится не просто полезным навыком, а настоящей необходимостью. Исследования показывают, что люди, которые планируют свой день заранее, выполняют на 25% больше задач.',
  'Одним из наиболее популярных подходов является техника Pomodoro, разработанная Франческо Чирилло.',
  'Её суть заключается в том, чтобы работать короткими интервалами по 25 минут.',
];

async function open(mode, { doc } = {}) {
  const browser = await chromium.launch();
  const touch = mode === 'touch';
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch, colorScheme: 'dark' });
  await ctx.route((u) => u.protocol.startsWith('http') && u.hostname !== '127.0.0.1', (route) => route.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  if (doc) await seed(page, BASE, [doc], 'split', doc.id);
  else {
    await page.goto(BASE);
    await page.locator('textarea').fill(SOURCE);
    await page.getByRole('button', { name: 'Начать', exact: true }).click();
  }
  await page.locator('li[data-block-id]').first().waitFor();
  return { browser, ctx, page, errors, mode };
}

const items = (page) => page.locator('li[data-block-id]');
const count = (page) => items(page).count();
// textContent, а не innerText: блоки вне экрана под content-visibility отдают пустой innerText.
const texts = (page) =>
  items(page).evaluateAll((els) =>
    els.map((e) => {
      const copy = e.querySelector('[data-block-text]').cloneNode(true);
      copy.querySelectorAll('.cut-row').forEach((n) => n.replaceWith(' ')); // в режиме разреза на месте пробела кнопка
      return copy.textContent.replace(/\s+/g, ' ').trim();
    }),
  );
const ids = (page) => items(page).evaluateAll((els) => els.map((e) => e.dataset.blockId));
const title = (page) => page.locator('h1').innerText();
const flushed = (page) => page.waitForTimeout(900);
const stored = async (page) => (await readDocs(page))[0];
const rows = (page) => page.locator('.cut-row');
const toggle = (page, name) => page.getByRole('button', { name, exact: true });
const modeOn = async (page) => (await toggle(page, 'Готово').count()) === 1;
const status = (page) => page.getByRole('status').filter({ hasText: 'Блок разрезан' });

/** Нажатие так, как его делает пользователь режима: щелчок, касание или фокус и Enter. */
async function press(ctx, locator) {
  if (ctx.mode === 'mouse') await locator.click();
  else if (ctx.mode === 'touch') await locator.tap();
  else {
    await locator.focus();
    await ctx.page.keyboard.press('Enter');
  }
  await ctx.page.waitForTimeout(120);
}
const enable = (ctx) => press(ctx, toggle(ctx.page, 'Режим разреза'));
const finishMode = (ctx) => press(ctx, toggle(ctx.page, 'Готово'));

/** Блоки вне экрана меняют высоту, когда до них доскроллили (content-visibility): ждём, пока положение устоится. */
async function settle(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  let prev = null;
  for (let k = 0; k < 20; k++) {
    const y = await locator.evaluate((el) => Math.round(el.getBoundingClientRect().top + scrollY));
    if (y === prev) return;
    prev = y;
    await locator.page().waitForTimeout(80);
  }
}

/** Нажимает на точку разреза `which` блока `li` (режим уже включён). */
async function cutRow(ctx, li, which = 0) {
  await settle(li);
  await press(ctx, li.locator('.cut-row').nth(which));
}

const reload = async (page) => {
  await page.reload();
  await page.locator('li[data-block-id]').first().waitFor();
};

async function run(name, mode, body, opts) {
  const ctx = await open(mode, opts);
  const label = `[${mode}] ${name}`;
  try {
    await body(ctx, (cond, msg) => r.ok(cond, `${label}: ${msg}`));
  } catch (e) {
    r.ok(false, `${label}: исключение ${String(e).split('\n')[0]}`);
  } finally {
    if (ctx.errors.length) r.ok(false, `${label}: ошибки страницы ${ctx.errors.join('; ')}`);
    await ctx.browser.close();
  }
}

(async () => {
  for (const mode of MODES) {
    // а) основной сценарий: 4 блока подряд и правая часть первого ещё раз. +5, перезагрузка, «Начать».
    await run('а) режим, разрезы блоков 1, 3, 5, 8 и правой части блока 1', mode, async (ctx, ok) => {
      const { page } = ctx;
      const n0 = await count(page);
      ok(n0 === 8, `исходно ${n0} блоков (нужно 8)`);
      const before = await texts(page);
      const idsBefore = await ids(page);
      ok(!(await modeOn(page)) && (await rows(page).count()) === 0, 'до включения режима кнопок разреза нет');
      ok((await page.getByRole('button', { name: 'Разрезать', exact: true }).count()) === 0, 'отдельных кнопок «Разрезать» под блоками нет');

      await enable(ctx);
      ok(await modeOn(page), 'кнопка «Режим разреза» стала «Готово»');
      ok(await page.getByText(HINT).isVisible(), 'сверху подсказка «Нажми на кнопку между предложениями…»');
      ok((await rows(page).count()) === CUT_POINTS, `во всех блоках сразу все точки разреза: ${await rows(page).count()} из ${CUT_POINTS}`);
      ok(await page.getByText(INTRO).isVisible(), 'при первом включении есть одноразовое пояснение');
      await page.screenshot({ path: `${OUT}/split-cut-mode-${mode}-360.png` });

      let expected = n0;
      let shotDone = false;
      for (const k of [0, 2, 4, 7]) {
        const li = page.locator(`li[data-block-id="${idsBefore[k]}"]`);
        const row = li.locator('.cut-row').first();
        // Первый блок у верхнего края и так на экране: не прокручиваем, чтобы снимок «сразу после разреза» показал заголовок и сообщение.
        const seen = k === 0 ? await row.boundingBox() : null;
        if (!seen || seen.y < 60 || seen.y + seen.height > 740 - 80) {
          await settle(li);
          await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
          await page.waitForTimeout(100);
        }
        const scroll0 = await page.evaluate(() => Math.round(scrollY));
        await press(ctx, row);
        expected++;
        ok((await count(page)) === expected, `блок ${k + 1}: блоков стало ${expected}`);
        ok(await modeOn(page), `блок ${k + 1}: режим остался включённым`);
        ok((await title(page)).includes(String(expected)), `блок ${k + 1}: заголовок показывает ${expected}`);
        ok(await status(page).filter({ hasText: `Блок разрезан, теперь блоков: ${expected}` }).count() === 1, `блок ${k + 1}: «Блок разрезан, теперь блоков: ${expected}»`);
        const flash = await items(page).evaluateAll((els) => els.map((e, i) => (e.hasAttribute('data-flash') ? i : -1)).filter((i) => i >= 0));
        const at = (await ids(page)).indexOf(idsBefore[k]);
        ok(flash.length === 1 && flash[0] === at + 1, `блок ${k + 1}: подсвечена только правая часть`);
        const focus = await page.evaluate(() => {
          const a = document.activeElement;
          return { row: !!a?.classList.contains('cut-row'), mode: a?.textContent === 'Готово', blockIndex: a?.closest('li') ? [...document.querySelectorAll('li[data-block-id]')].indexOf(a.closest('li')) : -1 };
        });
        ok(focus.row || focus.mode, `блок ${k + 1}: фокус остался на кнопке разреза или режима`);
        if (focus.row) ok(focus.blockIndex === at || focus.blockIndex === at + 1, `блок ${k + 1}: фокус рядом с местом разреза (${focus.blockIndex})`);
        const scroll1 = await page.evaluate(() => Math.round(scrollY));
        ok(Math.abs(scroll1 - scroll0) <= 1, `блок ${k + 1}: экран не прыгнул (${scroll0} → ${scroll1})`);
        if (!shotDone) {
          shotDone = true;
          await page.screenshot({ path: `${OUT}/split-after-cut-${mode}-360.png` });
        }
      }
      // Правая часть блока 1 ещё раз.
      const right = items(page).nth(1);
      ok((await right.locator('.cut-row').count()) === 1, 'у правой части блока 1 осталась одна точка разреза');
      await cutRow(ctx, right, 0);
      expected++;
      ok(expected === n0 + 5 && (await count(page)) === n0 + 5, `блоков стало ${await count(page)}, ожидалось ${n0 + 5}`);
      ok((await texts(page)).join(' ').replace(/\s+/g, ' ') === before.join(' '), 'текст блоков в сумме не изменился');
      ok(new Set(await ids(page)).size === n0 + 5, 'id блоков уникальны');
      await page.waitForTimeout(1100);
      ok((await items(page).evaluateAll((els) => els.filter((e) => e.hasAttribute('data-flash')).length)) === 0, 'через секунду подсветка погасла');
      await page.waitForTimeout(2200);
      ok((await status(page).count()) === 0, 'через 3 секунды сообщение о разрезе исчезло');
      ok(await modeOn(page), 'режим всё ещё включён, пока пользователь не вышел сам');

      await finishMode(ctx);
      ok(!(await modeOn(page)) && (await rows(page).count()) === 0, '«Готово» выключает режим');
      await flushed(page);
      ok((await stored(page)).blocks.length === n0 + 5, 'в хранилище +5 блоков');
      await reload(page);
      ok((await count(page)) === n0 + 5, 'после перезагрузки все 5 разрезов на месте');
      ok(!(await modeOn(page)), 'после перезагрузки режим выключен');

      await page.getByRole('button', { name: 'Начать', exact: true }).click();
      await page.getByText(`1 из ${n0 + 5}`).first().waitFor({ timeout: 5000 });
      ok(true, `сессия показывает «1 из ${n0 + 5}»`);
    });

    // б) регрессия пользователя: включил режим, не нажимал на строки, вышел: разрезов нет. Потом с нажатием.
    await run('б) регрессия: режим без нажатий, выход, затем с нажатием', mode, async (ctx, ok) => {
      const { page } = ctx;
      const n0 = await count(page);
      const t0 = await texts(page);
      await enable(ctx);
      ok((await rows(page).count()) === CUT_POINTS, 'режим включён, точки разреза видны');
      if (mode === 'keyboard') {
        await page.keyboard.press('Escape');
        ok(!(await modeOn(page)), 'Esc выходит из режима');
        await enable(ctx);
      }
      await finishMode(ctx);
      ok(!(await modeOn(page)), 'вышли кнопкой «Готово»');
      ok((await count(page)) === n0 && JSON.stringify(await texts(page)) === JSON.stringify(t0), 'без нажатий на строки разрезов нет');
      await flushed(page);
      ok((await stored(page)).blocks.length === n0, 'и в хранилище блоков столько же');
      await enable(ctx);
      await cutRow(ctx, items(page).nth(2), 0);
      ok((await count(page)) === n0 + 1, 'с нажатием на строку разрез есть');
      await finishMode(ctx);
      await flushed(page);
      await reload(page);
      ok((await count(page)) === n0 + 1, 'и он пережил перезагрузку');
    });

    // в) документ из скриншота пользователя: 3 блока, в первом ровно одна точка разреза.
    await run('в) документ из 3 блоков: в первом одна точка', mode, async (ctx, ok) => {
      const { page } = ctx;
      ok((await count(page)) === 3, 'на Split 3 блока');
      await enable(ctx);
      const first = items(page).nth(0);
      ok((await first.locator('.cut-row').count()) === 1, 'в блоке «В современном мире…» одна точка разреза');
      ok((await rows(page).count()) === 1, 'во всём документе одна точка');
      ok((await page.locator('[data-cut-none]').filter({ hasText: 'одно предложение' }).count()) === 2, 'у двух других блоков приглушённая подпись «одно предложение»');
      await page.screenshot({ path: `${OUT}/split-3blocks-${mode}-360.png` });
      await cutRow(ctx, first, 0);
      ok((await count(page)) === 4, 'после разреза 4 блока');
      ok((await rows(page).count()) === 0, 'точек разреза больше нет, режим при этом включён');
      ok(await modeOn(page), 'режим остаётся включённым до «Готово»');
    }, { doc: makeDoc({ id: 'shot-doc', sources: SHOT_SOURCES, texts: [], status: 'pending' }) });

    // г) нет точек разреза: кнопка неактивна с подписью.
    await run('г) блоки по одному предложению: режим неактивен', mode, async (ctx, ok) => {
      const { page } = ctx;
      const btn = toggle(ctx.page, 'Режим разреза');
      ok(await btn.isDisabled(), 'кнопка «Режим разреза» неактивна');
      ok(await page.getByText('в блоках по одному предложению').isVisible(), 'рядом подпись «в блоках по одному предложению»');
      await page.screenshot({ path: `${OUT}/split-no-cut-points-${mode}-360.png` });
    }, { doc: makeDoc({ id: 'one-doc', sources: SHOT_SOURCES.slice(1), texts: [], status: 'pending' }) });

    // д) пояснение один раз, отмена в режиме, выход по Esc, «Начать» и смена размера.
    await run('д) пояснение один раз, «Отменить действие», Esc, смена размера', mode, async (ctx, ok) => {
      const { page } = ctx;
      const n0 = await count(page);
      const undo = page.getByRole('button', { name: 'Отменить действие', exact: true });
      ok(await undo.isDisabled(), '«Отменить действие» неактивна, пока нечего отменять');
      ok((await undo.locator('svg').count()) === 1, 'у «Отменить действие» есть иконка возврата');
      await enable(ctx);
      ok(await page.getByText(INTRO).isVisible(), 'первое включение: пояснение показано');
      await finishMode(ctx);
      await enable(ctx);
      ok((await page.getByText(INTRO).count()) === 0, 'второе включение: пояснения нет');
      await flushed(page);
      await reload(page);
      await enable(ctx);
      ok((await page.getByText(INTRO).count()) === 0, 'после перезагрузки пояснение тоже не возвращается (cutIntroSeen в настройках)');

      await cutRow(ctx, items(page).nth(1), 0);
      await cutRow(ctx, items(page).nth(4), 0);
      ok((await count(page)) === n0 + 2, 'два разреза в разных блоках');
      ok(await undo.isEnabled(), '«Отменить действие» стала активна');
      await press(ctx, undo);
      ok((await count(page)) === n0 + 1 && (await modeOn(page)), 'отмена вернула последний разрез, режим остался включённым');
      ok((await status(page).count()) === 0, 'сообщение о разрезе после отмены убрано');
      await cutRow(ctx, items(page).nth(4), 0);
      ok((await count(page)) === n0 + 2, 'после отмены режим продолжает резать');
      await page.keyboard.press('Escape');
      ok(!(await modeOn(page)), 'Esc выходит из режима');
      if (mode === 'keyboard') {
        await enable(ctx);
        await page.keyboard.press('Control+z');
        ok((await count(page)) === n0 + 1 && (await modeOn(page)), 'Ctrl+Z тоже отменяет, режим остаётся');
        await page.keyboard.press('Escape');
      } else {
        await enable(ctx);
        await finishMode(ctx);
      }
      // Смена размера выключает режим: подтверждение стирает разрезы.
      await enable(ctx);
      await press(ctx, page.getByRole('radio', { name: 'Длинные' }).or(page.getByRole('button', { name: 'Длинные' })).first());
      await press(ctx, page.getByRole('button', { name: 'Сменить размер' }));
      ok(!(await modeOn(page)), 'смена размера выключила режим');
      // «Начать» тоже: сессия открывается, при возврате режим выключен.
      await enable(ctx);
      await press(ctx, page.getByRole('button', { name: 'Начать', exact: true }));
      await page.getByText(/^1 из \d+/).first().waitFor({ timeout: 5000 });
      await page.getByRole('button', { name: 'Мои тексты' }).click();
      await page.locator('li button, li a, li [role="button"]').filter({ hasText: /Продолжить|Открыть/ }).first().click();
      await page.locator('li[data-block-id]').first().waitFor();
      ok(!(await modeOn(page)), '«Начать» и возврат на экран: режим выключен');
    });

    // е) вид строки разреза: кнопка с ножницами, высота 40+, контур цветом ink, aria-label, состояния фокуса.
    await run('е) вид и доступность строки разреза', mode, async (ctx, ok) => {
      const { page } = ctx;
      await enable(ctx);
      const row = rows(page).first();
      const box = await row.boundingBox();
      ok(box.height >= 40, `высота ${box.height} px (не меньше 40)`);
      ok(box.x >= 0 && box.x + box.width <= 360, `в 360 px помещается (x=${box.x}, w=${box.width})`);
      ok((await row.innerText()).trim() === 'Разрезать здесь', 'подпись «Разрезать здесь»');
      ok((await row.locator('svg').count()) === 1, 'иконка ножниц (svg)');
      const label = await row.getAttribute('aria-label');
      ok(label === 'Разрезать блок здесь, после предложения: Абзац 1 предложение 1 про река', `aria-label: «${label}»`);
      const css = await row.evaluate((el) => {
        const probe = document.createElement('i');
        probe.style.color = 'var(--ink)';
        document.body.append(probe);
        const ink = getComputedStyle(probe).color;
        probe.remove();
        const s = getComputedStyle(el);
        return { ink, border: s.borderTopColor, width: s.borderTopWidth, style: s.borderTopStyle };
      });
      ok(css.border === css.ink && css.width === '1px' && css.style === 'solid', `контурная рамка цветом --ink (${css.border} = ${css.ink})`);
      // С клавиатуры: Tab от кнопки режима доходит до строки (сначала могут встретиться маркеры фраз).
      await toggle(page, 'Готово').focus();
      for (let k = 0; k < 12 && !(await page.evaluate(() => document.activeElement?.classList.contains('cut-row'))); k++) await page.keyboard.press('Tab');
      const outline = await page.evaluate(() => (document.activeElement?.classList.contains('cut-row') ? getComputedStyle(document.activeElement).outlineStyle : 'none'));
      ok(outline !== 'none', 'у сфокусированной строки виден контур фокуса');
    });

    // ж) мышь: клик по месту между предложениями режет и без режима; режим при этом не включается.
    if (mode === 'mouse') {
      await run('ж) мышь без режима: клик по месту режет, режим не включается', mode, async (ctx, ok) => {
        const { page } = ctx;
        const n0 = await count(page);
        const li = items(page).nth(3);
        await settle(li);
        const gap = li.locator('.cut-gap').first();
        const pos = await gap.evaluate((el) => {
          const rect = el.getClientRects()[0];
          return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
        });
        await page.mouse.move(pos.x, pos.y);
        await page.mouse.click(pos.x, pos.y);
        await page.waitForTimeout(150);
        ok((await count(page)) === n0 + 1, 'клик по месту разреза режет сразу');
        ok(!(await modeOn(page)), 'режим при этом не включился');
      });
    }
  }

  // з) reduced motion: подсветка правой части без анимации.
  {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, reducedMotion: 'reduce', colorScheme: 'dark' });
    await ctx.route((u) => u.protocol.startsWith('http') && u.hostname !== '127.0.0.1', (route) => route.abort());
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.locator('textarea').fill(SOURCE);
    await page.getByRole('button', { name: 'Начать', exact: true }).click();
    await page.locator('li[data-block-id]').first().waitFor();
    await toggle(page, 'Режим разреза').click();
    await rows(page).first().click();
    await page.waitForTimeout(100);
    const flash = await page.locator('li[data-flash]').evaluate((el) => {
      const s = getComputedStyle(el);
      const probe = document.createElement('i');
      probe.style.backgroundColor = 'var(--surface)';
      document.body.append(probe);
      const surface = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { anim: s.animationName, bg: s.backgroundColor, surface };
    });
    r.ok(flash.anim === 'none' && flash.bg === flash.surface, `[reduced motion] подсветка без анимации, фон --surface (${JSON.stringify(flash)})`);
    await browser.close();
  }

  console.log(r.failed ? `\nПровалено проверок: ${r.failed}` : '\nВсе проверки прошли');
  process.exit(r.failed ? 1 : 0);
})();
