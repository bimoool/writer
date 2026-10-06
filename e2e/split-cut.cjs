/*
 * Ручная разрезка блоков на Split (SPEC §3.2) в Chromium: мышь, касание, клавиатура.
 * Запуск: npm run build && npx vite preview --port 4173 --host 127.0.0.1 &
 *         node e2e/split-cut.cjs <папка для скриншотов> [адрес] [режимы через запятую: mouse,touch,keyboard]
 * Код выхода не нулевой, если хоть одна проверка упала.
 */
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { readDocs, reporter } = require('./lib.cjs');

const OUT = process.argv[2] || 'e2e-out';
const BASE = process.argv[3] || 'http://127.0.0.1:4173/';
const MODES = (process.argv[4] || 'mouse,touch,keyboard').split(',');
fs.mkdirSync(OUT, { recursive: true });
const r = reporter();

/** 10 абзацев по 3 предложения: каждый становится отдельным блоком, в каждом две точки разреза. */
const TOPICS = ['река', 'гора', 'озеро', 'лес', 'поле', 'город', 'мост', 'остров', 'долина', 'берег'];
const SOURCE = TOPICS.map(
  (t, i) =>
    `Абзац номер ${i + 1} рассказывает про ${t} и её необычный характер в разные времена года. ` +
    `Местные жители давно привыкли к тому, что ${t} меняется каждый сезон. ` +
    `Путешественники любят возвращаться туда снова, чтобы увидеть новые краски.`,
).join('\n\n');

async function open(mode) {
  const browser = await chromium.launch();
  const touch = mode === 'touch';
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch, colorScheme: 'dark' });
  await ctx.route((u) => u.protocol.startsWith('http') && u.hostname !== '127.0.0.1', (route) => route.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE);
  await page.locator('textarea').fill(SOURCE);
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  await page.locator('li[data-block-id]').first().waitFor();
  return { browser, page, errors, mode };
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
const markers = (page) => items(page).evaluateAll((els) => els.map((e) => [...e.querySelectorAll('.marker')].map((m) => m.textContent)));
const ids = (page) => items(page).evaluateAll((els) => els.map((e) => e.dataset.blockId));
const title = (page) => page.locator('h1').innerText();
const flushed = (page) => page.waitForTimeout(900);
const stored = async (page) => (await readDocs(page))[0];
const storedTexts = async (page) => (await stored(page)).blocks.map((b) => b.sourceText);

/** Режет блок `i` (номер в текущем списке) в первой доступной точке. Возвращает, сколько блоков должно стать. */
async function cut(ctx, i, which = 0) {
  const { page, mode } = ctx;
  const li = items(page).nth(i);
  await li.scrollIntoViewIfNeeded();
  if (mode === 'mouse') {
    // content-visibility: блоки вне экрана меняют высоту, когда до них доскроллили: ждём, пока позиция устоится.
    const gap = li.locator('.cut-gap').nth(which);
    let pos = null;
    for (let k = 0; k < 20; k++) {
      const next = await gap.evaluate((el) => {
        const rect = el.getClientRects()[0];
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      });
      if (pos && pos.x === next.x && pos.y === next.y) break;
      pos = next;
      await page.waitForTimeout(100);
    }
    await page.mouse.move(pos.x, pos.y);
    await page.mouse.click(pos.x, pos.y);
  } else if (mode === 'touch') {
    const toggle = li.locator('[data-action="cut"]');
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.tap();
    await li.locator('.cut-row').nth(which).tap();
  } else {
    const toggle = li.locator('[data-action="cut"]');
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
      await toggle.focus();
      await page.keyboard.press('Enter');
    }
    await li.locator('.cut-row').nth(which).focus();
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(150);
}

const closeCutMode = async (ctx) => {
  const open = ctx.page.locator('[data-action="cut"][aria-pressed="true"]');
  while ((await open.count()) > 0) {
    await open.first().click();
    await ctx.page.waitForTimeout(50);
  }
};

/** Три снимка 360 px: у первого, среднего и последнего разреза (блоки вне экрана не рисуются, полный кадр был бы пустым). */
const shoot = async (page, name) => {
  const n = await count(page);
  for (const [tag, i] of [['first', 1], ['middle', Math.floor(n / 2) + 1], ['last', n - 1]]) {
    await items(page).nth(i).scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${name}-${tag}-360.png` });
  }
};

const reload = async (page) => {
  await page.reload();
  await page.locator('li[data-block-id]').first().waitFor();
};

async function run(name, mode, body) {
  const ctx = await open(mode);
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
    // а) первый, средний, последний, не выходя с экрана.
    await run('а) три разреза: первый, средний, последний', mode, async (ctx, ok) => {
      const { page } = ctx;
      const n0 = await count(page);
      ok(n0 >= 8, `исходно ${n0} блоков (нужно 8+)`);
      const before = await texts(page);
      const mid = Math.floor(n0 / 2);
      // Режем с конца, чтобы номера не съезжали, а затем проверяем по тексту.
      await cut(ctx, 0);
      await cut(ctx, mid + 1);
      await cut(ctx, (await count(page)) - 1); // последний блок
      const n1 = await count(page);
      ok(n1 === n0 + 3, `блоков стало ${n1}, ожидалось ${n0 + 3}`);
      ok((await title(page)).includes(String(n0 + 3)), 'заголовок показывает новое число блоков');
      const after = await texts(page);
      const all = after.join(' ');
      ok(all.replace(/\s+/g, ' ') === before.join(' '), 'текст блоков в сумме не изменился');
      ok(new Set(await ids(page)).size === n1, 'id блоков уникальны');
      await flushed(page);
      ok((await storedTexts(page)).length === n0 + 3, 'в хранилище тоже +3 блока');
      await shoot(page, `a-${mode}-after-cuts`);
      await reload(page);
      ok((await count(page)) === n0 + 3, 'после перезагрузки те же +3 блока');
      await shoot(page, `a-${mode}-after-reload`);
    });

    // б) два разреза подряд в одном блоке.
    await run('б) два разреза в одном блоке', mode, async (ctx, ok) => {
      const { page } = ctx;
      const n0 = await count(page);
      // Сначала по второй точке (левая часть остаётся из двух предложений), потом по первой левой части.
      await cut(ctx, 2, 1);
      ok((await count(page)) === n0 + 1, 'после первого разреза +1');
      await cut(ctx, 2, 0);
      ok((await count(page)) === n0 + 2, 'после второго разреза +2');
      // Для другого блока: сначала по первой точке, потом правая часть.
      await cut(ctx, 5, 0);
      await cut(ctx, 6, 0);
      ok((await count(page)) === n0 + 4, 'и ещё два разреза в другом блоке: +4');
      const t = await texts(page);
      ok(t.slice(2, 5).every((x) => !/[.!?] \S/.test(x)), 'блоки 3–5 по одному предложению');
      await flushed(page);
      await reload(page);
      ok((await count(page)) === n0 + 4, 'после перезагрузки +4');
      ok(JSON.stringify(await texts(page)) === JSON.stringify(t), 'тексты блоков те же');
    });

    // в) два разных блока и перезагрузка: блоки и фразы те же.
    await run('в) разрез в двух блоках и перезагрузка', mode, async (ctx, ok) => {
      const { page } = ctx;
      const n0 = await count(page);
      await cut(ctx, 1);
      await cut(ctx, 6);
      const t = await texts(page);
      const m = await markers(page);
      ok(t.length === n0 + 2, `после двух разрезов ${t.length} блоков`);
      await flushed(page);
      await reload(page);
      ok(JSON.stringify(await texts(page)) === JSON.stringify(t), 'тексты блоков после перезагрузки те же');
      ok(JSON.stringify(await markers(page)) === JSON.stringify(m), 'ключевые фразы после перезагрузки те же');
    });

    // г) выход на Home и повторное открытие.
    await run('г) выход на Home и повторное открытие', mode, async (ctx, ok) => {
      const { page } = ctx;
      const n0 = await count(page);
      await cut(ctx, 0);
      await cut(ctx, 4);
      const t = await texts(page);
      await page.getByRole('button', { name: /Назад/ }).click();
      await page.getByText('Твои тексты').waitFor();
      await page.locator('li button, li a, li [role="button"]').filter({ hasText: /Продолжить|Открыть/ }).first().click();
      await page.locator('li[data-block-id]').first().waitFor();
      ok((await count(page)) === n0 + 2, 'после повторного открытия +2 блока');
      ok(JSON.stringify(await texts(page)) === JSON.stringify(t), 'тексты те же');
    });

    // д) «Начать»: сессия идёт по новым блокам, Result показывает их же.
    await run('д) Начать: сессия и Result по новым блокам', mode, async (ctx, ok) => {
      const { page } = ctx;
      const n0 = await count(page);
      await cut(ctx, 0);
      await cut(ctx, 3);
      await closeCutMode(ctx);
      const total = n0 + 2;
      await page.getByRole('button', { name: 'Начать', exact: true }).click();
      await page.getByText(`1 из ${total}`).first().waitFor({ timeout: 5000 });
      ok(true, `сессия показывает «1 из ${total}»`);
      const sessionDoc = await (async () => {
        await page.waitForTimeout(900);
        return stored(page);
      })();
      ok(sessionDoc.blocks.length === total, 'в хранилище к моменту старта сессии те же блоки');
      for (let i = 0; i < total; i++) {
        await page.getByRole('button', { name: 'Запомнил' }).click();
        const field = page.locator('textarea');
        await field.waitFor({ timeout: 5000 });
        await page.waitForTimeout(1400); // растворение блока
        await field.focus();
        await page.keyboard.type(`Мой пересказ номер ${i + 1}, написанный своими словами.`);
        await page.getByRole('button', { name: /^Готово/ }).click();
        await page.waitForTimeout(100);
      }
      await page.getByRole('heading', { name: 'Готово' }).waitFor({ timeout: 8000 });
      ok(await page.getByText(`${total} блоков`).first().isVisible().catch(() => false), `Result показывает «${total} блоков»`);
    });

    // е) смена размера: с подтверждением разрезы пропадают, без (отмена) остаются.
    await run('е) смена размера блоков', mode, async (ctx, ok) => {
      const { page } = ctx;
      const n0 = await count(page);
      await cut(ctx, 0);
      await cut(ctx, 5);
      await closeCutMode(ctx);
      const t = await texts(page);
      await page.getByRole('radio', { name: 'Длинные' }).or(page.getByRole('button', { name: 'Длинные' })).first().click();
      await page.getByRole('button', { name: 'Оставить как есть' }).click();
      ok(JSON.stringify(await texts(page)) === JSON.stringify(t), 'отмена смены размера: разрезы остались');
      await flushed(page);
      await reload(page);
      ok((await count(page)) === n0 + 2, 'и после перезагрузки остались');
      await page.getByRole('radio', { name: 'Длинные' }).or(page.getByRole('button', { name: 'Длинные' })).first().click();
      await page.getByRole('button', { name: 'Сменить размер' }).click();
      await page.waitForTimeout(300);
      const after = await count(page);
      ok(after !== n0 + 2 || JSON.stringify(await texts(page)) !== JSON.stringify(t), 'подтверждение: разрезы пропали (разбивка пересчитана)');
      await flushed(page);
      await reload(page);
      ok((await count(page)) === after, 'пересчитанная разбивка пережила перезагрузку');
    });

    // ж) «Отменить» и Ctrl/Cmd+Z.
    await run('ж) Отменить и Ctrl+Z', mode, async (ctx, ok) => {
      const { page } = ctx;
      const n0 = await count(page);
      await cut(ctx, 2);
      await closeCutMode(ctx);
      ok((await count(page)) === n0 + 1, 'разрез: +1');
      await page.getByRole('button', { name: 'Отменить', exact: true }).click();
      ok((await count(page)) === n0, '«Отменить»: вернулось');
      await cut(ctx, 2);
      await closeCutMode(ctx);
      ok((await count(page)) === n0 + 1, 'повторный разрез снова работает');
      await page.locator('h1').focus();
      await page.keyboard.press('Control+z');
      ok((await count(page)) === n0, 'Ctrl+Z: вернулось');
      await cut(ctx, 4);
      await closeCutMode(ctx);
      ok((await count(page)) === n0 + 1, 'разрез после Ctrl+Z работает');
      const t = await texts(page);
      await flushed(page);
      await reload(page);
      ok(JSON.stringify(await texts(page)) === JSON.stringify(t), 'после перезагрузки сохранилось текущее состояние');
    });

    // з) быстрый разрез и немедленная перезагрузка.
    await run('з) разрез и немедленная перезагрузка', mode, async (ctx, ok) => {
      const { page } = ctx;
      const n0 = await count(page);
      await cut(ctx, 1);
      await cut(ctx, 3);
      await page.reload();
      await page.locator('li[data-block-id]').first().waitFor();
      ok((await count(page)) === n0 + 2, 'разрезы сохранены без паузы');
    });
  }

  // Режим разреза (SPEC §3.2): явный и предсказуемый.
  for (const mode of MODES) {
    const pressed = (page) => page.locator('[data-action="cut"][aria-pressed="true"]');
    const place = (page, i) => items(page).nth(i).evaluate((el) => ({ scroll: Math.round(scrollY), top: Math.round(el.getBoundingClientRect().top) }));

    await run('и) режим остаётся после разреза, Esc и «Отмена»', mode, async (ctx, ok) => {
      const { page } = ctx;
      if (mode === 'mouse') {
        // Мышь режет кликом по месту без режима и режим не включает.
        const n0 = await count(page);
        await cut(ctx, 3);
        ok((await count(page)) === n0 + 1, 'клик по месту разреза режет сразу, без режима');
        ok((await pressed(page).count()) === 0, 'и режим «Разрезать» при этом не включается');
        return;
      }
      const n0 = await count(page);
      await cut(ctx, 3, 0); // первый разрез: режим открыт
      ok((await count(page)) === n0 + 1, 'первый разрез: +1');
      ok((await pressed(page).count()) === 1, 'режим остался открытым после разреза');
      // Режем дальше без повторного нажатия на «Разрезать»: теперь режим на блоке с оставшейся точкой.
      const open = items(page).filter({ has: page.locator('[data-action="cut"][aria-pressed="true"]') });
      const rows = open.locator('.cut-row');
      ok((await rows.count()) === 1, 'у блока с открытым режимом осталась одна точка разреза');
      if (mode === 'touch') await rows.first().tap();
      else {
        await rows.first().focus();
        await page.keyboard.press('Enter');
      }
      await page.waitForTimeout(150);
      ok((await count(page)) === n0 + 2, 'второй разрез подряд без повторного включения: +2, блок на три части');
      ok((await pressed(page).count()) === 0, 'когда резать больше негде, режим закрылся');

      // Esc закрывает режим (клавиатура), «Отмена» закрывает (касание).
      const li = items(page).nth(0);
      await li.scrollIntoViewIfNeeded();
      const toggle = li.locator('[data-action="cut"]');
      if (mode === 'keyboard') {
        await toggle.focus();
        await page.keyboard.press('Enter');
        ok((await pressed(page).count()) === 1, 'Enter на «Разрезать» включает режим');
        await page.keyboard.press('Escape');
        ok((await pressed(page).count()) === 0, 'Esc выключает режим');
      } else {
        await toggle.tap();
        ok((await pressed(page).count()) === 1, 'касание «Разрезать» включает режим');
        await li.locator('[data-action="cut"]').tap();
        ok((await pressed(page).count()) === 0, '«Отмена» выключает режим');
        // Касание по тексту между предложениями разрез не делает.
        const before = await count(page);
        const gap = li.locator('.cut-gap').first();
        await gap.tap({ force: true });
        ok((await count(page)) === before, 'касание по тексту разрез не делает');
      }
    });

    await run('к) переключение режима на другой блок без потери разреза', mode, async (ctx, ok) => {
      const { page } = ctx;
      if (mode === 'mouse') return;
      const n0 = await count(page);
      await cut(ctx, 1, 0);
      ok((await pressed(page).count()) === 1, 'режим открыт после первого разреза');
      const second = items(page).nth(4);
      await second.scrollIntoViewIfNeeded();
      const toggle = second.locator('[data-action="cut"]');
      if (mode === 'touch') await toggle.tap();
      else {
        await toggle.focus();
        await page.keyboard.press('Enter');
      }
      await page.waitForTimeout(150);
      const open = await pressed(page).count();
      ok(open === 1 && (await second.locator('[data-action="cut"][aria-pressed="true"]').count()) === 1, 'режим переключился на другой блок, открыт только он');
      ok((await count(page)) === n0 + 1, 'первый разрез на месте');
      await cut(ctx, 4, 0);
      ok((await count(page)) === n0 + 2, 'в другом блоке режет');
      await flushed(page);
      await reload(page);
      ok((await count(page)) === n0 + 2, 'оба разреза пережили перезагрузку');
    });

    await run('л) блок без точек разреза: кнопка неактивна с причиной', mode, async (ctx, ok) => {
      const { page } = ctx;
      await cut(ctx, 0, 0);
      await cut(ctx, 1, 0);
      await closeCutMode(ctx);
      const li = items(page).nth(0);
      const btn = li.locator('[data-action="cut"]');
      ok(await btn.isDisabled(), 'у блока из одного предложения «Разрезать» неактивна');
      ok(((await li.innerText()) + (await li.textContent())).includes('в блоке одно предложение'), 'рядом подпись «в блоке одно предложение»');
      const other = items(page).nth(5).locator('[data-action="cut"]');
      ok(await other.isEnabled(), 'у блока с несколькими предложениями активна');
    });

    await run('м) после разреза экран не прыгает, фокус у места разреза', mode, async (ctx, ok) => {
      const { page } = ctx;
      const i = 6;
      await items(page).nth(i).scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      const before = await place(page, i);
      await cut(ctx, i, 0);
      const after = await place(page, i);
      ok(Math.abs(before.scroll - after.scroll) <= 1 && Math.abs(before.top - after.top) <= 1, `прокрутка и положение блока не изменились (${JSON.stringify(before)} → ${JSON.stringify(after)})`);
      const inBlock = await page.evaluate(() => {
        const a = document.activeElement;
        return a && a.closest('li[data-block-id]') ? [...document.querySelectorAll('li[data-block-id]')].indexOf(a.closest('li[data-block-id]')) : -1;
      });
      ok(inBlock === i || inBlock === i + 1, `фокус остался в разрезанном блоке (индекс ${inBlock})`);
      const move = await place(page, i);
      ok(Math.abs(move.scroll - before.scroll) <= 1, 'после фокуса прокрутка тоже на месте');
    });
  }

  await new Promise((res) => setTimeout(res, 0));
  console.log(r.failed ? `\nПровалено проверок: ${r.failed}` : '\nВсе проверки прошли');
  process.exit(r.failed ? 1 : 0);
})();
