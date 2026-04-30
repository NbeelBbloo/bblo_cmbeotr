require('dotenv').config();

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { Telegraf, Markup } = require('telegraf');

const TARGET_ATTR = 'data-tgbot-target';
const OVERLAY_ID = '__telegram_browser_bot_overlay__';
const FIND_ATTR = 'data-tgbot-found-text';

const sessions = new Map();

function env(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value === null || value === '' ? fallback : value;
}

function boolEnv(name, fallback = false) {
  const value = env(name, String(fallback)).toLowerCase().trim();
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function intEnv(name, fallback) {
  const parsed = Number.parseInt(env(name, String(fallback)), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgsLine(input) {
  if (!input || !input.trim()) return [];
  const args = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if ((ch === '"' || ch === "'") && !quote) {
      quote = ch;
      continue;
    }
    if (ch === quote) {
      quote = null;
      continue;
    }
    if (/\s/.test(ch) && !quote) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) args.push(current);
  return args;
}

function allowedUserIds() {
  return env('ALLOWED_USER_IDS', '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function isAllowed(ctx) {
  const list = allowedUserIds();
  if (list.length === 0 || list.includes('PUT_YOUR_TELEGRAM_USER_ID_HERE')) return true;
  const id = String(ctx.from?.id || '');
  return list.includes(id);
}

function normalizeUrl(input) {
  const value = String(input || '').trim();
  if (!value) throw new Error('الرابط فارغ.');
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

function truncate(text, max = 45) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function safeUrl(url) {
  const value = String(url || '');
  if (value.length <= 120) return value;
  return `${value.slice(0, 117)}…`;
}

function buildMainKeyboard(session) {
  const mode = session?.mode || 'normal';
  const targetRows = [];
  const targets = Array.isArray(session?.targets) ? session.targets : [];

  if (targets.length) {
    const rowSize = 5;
    for (let i = 0; i < targets.length; i += rowSize) {
      const row = targets.slice(i, i + rowSize).map((target) => {
        const prefix = target.editable ? '✍️' : '👆';
        const action = mode === 'fillTarget' ? 'filltarget' : 'tap';
        return Markup.button.callback(`${prefix} ${target.number}`, `${action}:${target.number}`);
      });
      targetRows.push(row);
    }
  }

  const modeRow = mode === 'fillTarget'
    ? [[Markup.button.callback('إلغاء وضع التعبئة', 'a:cancel')]]
    : [];

  return Markup.inlineKeyboard([
    [Markup.button.callback('🌐 فتح رابط', 'a:open'), Markup.button.callback('🔎 بحث Google', 'a:google')],
    [Markup.button.callback('📦 إظهار المربعات', 'a:boxes'), Markup.button.callback('📸 لقطة شاشة', 'a:shot')],
    [Markup.button.callback('✍️ تعبئة مربع', 'a:fillmode'), Markup.button.callback('⌨️ كتابة هنا', 'a:type')],
    [Markup.button.callback('🧹 مسح الحقل', 'a:clear'), Markup.button.callback('👆 اضغط على نص', 'a:clicktext')],
    [Markup.button.callback('🔍 ابحث عن نص', 'a:findtext'), Markup.button.callback('↵ Enter', 'a:enter')],
    [Markup.button.callback('⬅️ رجوع', 'a:back'), Markup.button.callback('🔄 تحديث', 'a:reload')],
    [Markup.button.callback('⬆️ سكرول أعلى', 'a:scrollup'), Markup.button.callback('⬇️ سكرول أسفل', 'a:scrolldown')],
    ...modeRow,
    ...targetRows,
  ]);
}

async function startHealthServer() {
  const app = express();
  const port = intEnv('PORT', 3000);
  app.get('/', (_req, res) => {
    res.status(200).send('Telegram browser bot is running.');
  });
  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true, sessions: sessions.size });
  });
  app.listen(port, () => {
    console.log(`Health server listening on port ${port}`);
  });
}

async function createSession(userId) {
  const viewport = {
    width: intEnv('VIEWPORT_WIDTH', 1365),
    height: intEnv('VIEWPORT_HEIGHT', 768),
  };

  const profileDir = path.join(os.tmpdir(), 'telegram-browser-bot-profiles', String(userId));
  fs.mkdirSync(profileDir, { recursive: true });

  const defaultArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
  ];

  const proxyServer = env('PROXY_SERVER', '');
  const proxy = proxyServer
    ? {
        server: proxyServer,
        username: env('PROXY_USERNAME', undefined),
        password: env('PROXY_PASSWORD', undefined),
      }
    : undefined;

  const executablePath = env('BROWSER_EXECUTABLE_PATH', undefined);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: boolEnv('HEADLESS', true),
    executablePath,
    args: [...defaultArgs, ...parseArgsLine(env('BROWSER_ARGS', ''))],
    viewport,
    deviceScaleFactor: Number(env('DEVICE_SCALE_FACTOR', '1')) || 1,
    locale: env('LOCALE', 'ar-IQ'),
    timezoneId: env('TIMEZONE_ID', 'Asia/Baghdad'),
    proxy,
    slowMo: intEnv('SLOW_MO', 0),
  });

  context.setDefaultTimeout(intEnv('NAVIGATION_TIMEOUT_MS', 60000));
  context.setDefaultNavigationTimeout(intEnv('NAVIGATION_TIMEOUT_MS', 60000));

  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(intEnv('NAVIGATION_TIMEOUT_MS', 60000));
  page.setDefaultNavigationTimeout(intEnv('NAVIGATION_TIMEOUT_MS', 60000));

  const session = {
    userId,
    context,
    page,
    targets: [],
    mode: 'normal',
    pending: null,
    selectedTargetNumber: null,
    createdAt: Date.now(),
  };

  context.on('close', () => {
    sessions.delete(String(userId));
  });

  const startUrl = env('DEFAULT_START_URL', 'https://www.google.com');
  try {
    await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    console.error('Initial navigation failed:', error.message);
  }

  sessions.set(String(userId), session);
  return session;
}

async function getSession(ctx) {
  const userId = String(ctx.from.id);
  const existing = sessions.get(userId);
  if (existing?.page && !existing.page.isClosed()) return existing;
  return createSession(userId);
}

async function closeSession(userId) {
  const key = String(userId);
  const session = sessions.get(key);
  if (session) {
    await session.context.close().catch(() => {});
    sessions.delete(key);
  }
}

async function waitAfterAction(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(intEnv('ACTION_DELAY_MS', 400)).catch(() => {});
}

async function collectTargets(page) {
  const max = intEnv('MAX_TARGETS', 30);
  return page.evaluate(({ max, attr }) => {
    const old = document.querySelectorAll(`[${attr}]`);
    old.forEach((el) => el.removeAttribute(attr));

    const selectors = [
      'a[href]',
      'button',
      'input:not([type="hidden"])',
      'textarea',
      'select',
      '[role="button"]',
      '[role="link"]',
      '[role="textbox"]',
      '[contenteditable="true"]',
      '[onclick]',
      'summary',
      'label',
      '[tabindex]:not([tabindex="-1"])',
    ];

    const seen = new Set();
    const elements = [];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!seen.has(el)) {
          seen.add(el);
          elements.push(el);
        }
      }
    }

    function isVisible(el) {
      const style = window.getComputedStyle(el);
      if (!style || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 6 || rect.height < 6) return false;
      if (rect.bottom < 0 || rect.right < 0) return false;
      if (rect.top > window.innerHeight || rect.left > window.innerWidth) return false;
      return true;
    }

    function labelOf(el) {
      const tag = el.tagName.toLowerCase();
      const candidates = [
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('placeholder'),
        el.getAttribute('name'),
        el.getAttribute('value'),
        tag === 'input' ? el.type : '',
        el.innerText,
        el.textContent,
        tag,
      ];
      const value = candidates.find((item) => item && String(item).trim());
      return String(value || tag).replace(/\s+/g, ' ').trim().slice(0, 70);
    }

    const out = [];
    let uid = 0;
    for (const el of elements) {
      if (!isVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || '';
      const editable = tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable || role === 'textbox';
      const id = `target_${Date.now()}_${uid}`;
      uid += 1;
      el.setAttribute(attr, id);
      out.push({
        number: out.length + 1,
        id,
        selector: `[${attr}="${id}"]`,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        text: labelOf(el),
        editable,
        tag,
        role,
      });
      if (out.length >= max) break;
    }
    return out;
  }, { max, attr: TARGET_ATTR });
}

async function screenshotWithBoxes(page, targets) {
  const showBoxes = boolEnv('SHOW_BOXES_AFTER_EACH_ACTION', true);
  if (showBoxes && targets.length) {
    await page.evaluate(({ targets, overlayId }) => {
      const old = document.getElementById(overlayId);
      if (old) old.remove();
      const root = document.createElement('div');
      root.id = overlayId;
      root.style.position = 'absolute';
      root.style.left = '0';
      root.style.top = '0';
      root.style.width = '0';
      root.style.height = '0';
      root.style.zIndex = '2147483647';
      root.style.pointerEvents = 'none';
      root.style.direction = 'ltr';

      for (const target of targets) {
        const box = document.createElement('div');
        box.style.position = 'absolute';
        box.style.left = `${window.scrollX + target.x}px`;
        box.style.top = `${window.scrollY + target.y}px`;
        box.style.width = `${Math.max(target.w, 14)}px`;
        box.style.height = `${Math.max(target.h, 14)}px`;
        box.style.border = target.editable ? '3px solid #00A3FF' : '3px solid #FF0033';
        box.style.boxSizing = 'border-box';
        box.style.borderRadius = '4px';
        box.style.background = 'rgba(255,255,255,0.05)';
        box.style.fontFamily = 'Arial, sans-serif';

        const label = document.createElement('div');
        label.textContent = String(target.number);
        label.style.position = 'absolute';
        label.style.left = '-3px';
        label.style.top = '-24px';
        label.style.minWidth = '22px';
        label.style.height = '22px';
        label.style.padding = '0 4px';
        label.style.lineHeight = '22px';
        label.style.textAlign = 'center';
        label.style.fontSize = '15px';
        label.style.fontWeight = 'bold';
        label.style.color = '#ffffff';
        label.style.background = target.editable ? '#0077CC' : '#D70022';
        label.style.borderRadius = '12px';
        label.style.boxShadow = '0 1px 4px rgba(0,0,0,.35)';
        box.appendChild(label);
        root.appendChild(box);
      }
      document.documentElement.appendChild(root);
    }, { targets, overlayId: OVERLAY_ID });
  }

  const buffer = await page.screenshot({ type: 'png', fullPage: false, animations: 'disabled' });

  await page.evaluate((overlayId) => {
    const old = document.getElementById(overlayId);
    if (old) old.remove();
  }, OVERLAY_ID).catch(() => {});

  return buffer;
}

async function buildCaption(session, message) {
  const page = session.page;
  const title = truncate(await page.title().catch(() => ''), 70);
  const url = safeUrl(page.url());
  const modeLine = session.mode === 'fillTarget'
    ? '\n📝 وضع التعبئة مفعل: اختر رقم الحقل من الأزرار بالأسفل.'
    : '';
  const targets = session.targets || [];
  const preview = targets.slice(0, 8).map((target) => {
    const icon = target.editable ? '✍️' : '👆';
    return `${icon} ${target.number}: ${truncate(target.text || target.tag, 28)}`;
  }).join('\n');
  const targetLine = targets.length ? `\n\nالمربعات الظاهرة:\n${preview}${targets.length > 8 ? '\n…' : ''}` : '\n\nلا توجد عناصر واضحة قابلة للتحكم في الجزء الظاهر.';

  return truncate(`${message || 'تم تحديث اللقطة.'}\n\n📄 ${title || 'بدون عنوان'}\n🔗 ${url}${modeLine}${targetLine}`, 1000);
}

async function sendScreenshot(ctx, session, message) {
  session.targets = await collectTargets(session.page).catch(() => []);
  const buffer = await screenshotWithBoxes(session.page, session.targets);
  const caption = await buildCaption(session, message);
  await ctx.replyWithPhoto(
    { source: buffer, filename: 'screenshot.png' },
    { caption, ...buildMainKeyboard(session) }
  );
}

async function sendErrorWithScreenshot(ctx, session, error, actionName = 'الإجراء') {
  const msg = `⚠️ حدث خطأ أثناء ${actionName}:\n${truncate(error?.message || error, 500)}`;
  if (session?.page && !session.page.isClosed()) {
    await sendScreenshot(ctx, session, msg).catch(async () => {
      await ctx.reply(msg, buildMainKeyboard(session));
    });
  } else {
    await ctx.reply(msg);
  }
}

async function tapTarget(session, number) {
  const target = session.targets.find((item) => item.number === number);
  if (!target) throw new Error('هذا الرقم غير موجود في اللقطة الحالية. اضغط زر "إظهار المربعات" ثم حاول مرة أخرى.');
  const locator = session.page.locator(target.selector).first();
  await locator.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {});
  await locator.click({ timeout: 15000 });
  session.selectedTargetNumber = number;
  await waitAfterAction(session.page);
}

async function fillTarget(session, number, text) {
  const target = session.targets.find((item) => item.number === number);
  if (!target) throw new Error('هذا الرقم غير موجود في اللقطة الحالية. اضغط زر "إظهار المربعات" ثم حاول مرة أخرى.');
  const locator = session.page.locator(target.selector).first();
  await locator.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {});

  try {
    await locator.fill(text, { timeout: 8000 });
  } catch (_error) {
    await locator.evaluate((el, value) => {
      function fire(name) {
        el.dispatchEvent(new Event(name, { bubbles: true }));
      }
      el.focus();
      if (el.isContentEditable) {
        el.textContent = value;
      } else if ('value' in el) {
        el.value = value;
      } else {
        el.textContent = value;
      }
      fire('input');
      fire('change');
    }, text);
  }

  session.selectedTargetNumber = number;
  session.mode = 'normal';
  session.pending = null;
  await waitAfterAction(session.page);
}

async function typeFocused(session, text) {
  await session.page.keyboard.insertText(text);
  await waitAfterAction(session.page);
}

async function clearFocused(session) {
  const cleared = await session.page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return false;
    function fire(name) {
      el.dispatchEvent(new Event(name, { bubbles: true }));
    }
    if (el.isContentEditable) {
      el.textContent = '';
      fire('input');
      fire('change');
      return true;
    }
    if ('value' in el) {
      el.value = '';
      fire('input');
      fire('change');
      return true;
    }
    return false;
  });
  if (!cleared) throw new Error('لا يوجد حقل محدد حاليا. اضغط على رقم حقل أزرق أولا ثم جرّب المسح.');
  await waitAfterAction(session.page);
}

async function findOrClickText(session, text, shouldClick) {
  const result = await session.page.evaluate(({ text, shouldClick, findAttr }) => {
    const query = String(text || '').trim().toLowerCase();
    if (!query) return { ok: false, reason: 'النص فارغ.' };

    document.querySelectorAll(`[${findAttr}]`).forEach((el) => {
      el.style.outline = el.getAttribute(`${findAttr}-old-outline`) || '';
      el.removeAttribute(`${findAttr}-old-outline`);
      el.removeAttribute(findAttr);
    });

    const selectors = [
      'a', 'button', 'input', 'textarea', 'select', '[role]', 'label', 'summary',
      'h1', 'h2', 'h3', 'h4', 'p', 'span', 'div', 'li', 'td', 'th'
    ];
    const seen = new Set();
    const candidates = [];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!seen.has(el)) {
          seen.add(el);
          candidates.push(el);
        }
      }
    }

    function isVisible(el) {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 2 && rect.height > 2;
    }

    function textOf(el) {
      return [
        el.getAttribute('aria-label'),
        el.getAttribute('placeholder'),
        el.getAttribute('title'),
        el.getAttribute('value'),
        el.innerText,
        el.textContent,
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    }

    let found = null;
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const value = textOf(el);
      if (value && value.toLowerCase().includes(query)) {
        found = el;
        break;
      }
    }

    if (!found) return { ok: false, reason: 'لم أجد النص في الجزء الحالي من الصفحة.' };

    found.scrollIntoView({ block: 'center', inline: 'center' });
    found.setAttribute(`${findAttr}-old-outline`, found.style.outline || '');
    found.setAttribute(findAttr, '1');
    found.style.outline = '4px solid #00C853';
    found.style.outlineOffset = '3px';

    if (shouldClick) {
      const clickable = found.closest('a,button,[role="button"],[role="link"],label,[onclick]') || found;
      clickable.click();
    }

    return { ok: true, label: textOf(found).slice(0, 120) };
  }, { text, shouldClick, findAttr: FIND_ATTR });

  if (!result.ok) throw new Error(result.reason || 'لم أجد النص.');
  await waitAfterAction(session.page);
  return result;
}

async function performAction(ctx, actionName, fn) {
  if (!isAllowed(ctx)) {
    await ctx.reply('⛔ غير مصرح لك باستخدام هذا البوت.');
    return;
  }

  let session;
  try {
    session = await getSession(ctx);
    await fn(session);
    await sendScreenshot(ctx, session, `✅ تم: ${actionName}`);
  } catch (error) {
    await sendErrorWithScreenshot(ctx, session, error, actionName);
  }
}

async function askForInput(ctx, session, pending, prompt) {
  session.pending = pending;
  await ctx.reply(prompt, Markup.inlineKeyboard([
    [Markup.button.callback('إلغاء', 'a:cancel')],
  ]));
}

function requireToken() {
  const token = env('TELEGRAM_BOT_TOKEN', '');
  if (!token || token === 'PUT_YOUR_BOT_TOKEN_HERE') {
    console.error('Missing TELEGRAM_BOT_TOKEN. ضع توكن البوت في متغيرات Railway.');
    process.exit(1);
  }
  return token;
}

const bot = new Telegraf(requireToken());

bot.telegram.setMyCommands([
  { command: 'start', description: 'تشغيل المتصفح وفتح لوحة التحكم' },
  { command: 'menu', description: 'إظهار لوحة التحكم' },
  { command: 'close', description: 'إغلاق جلسة المتصفح' },
]).catch(() => {});

bot.start(async (ctx) => {
  if (!isAllowed(ctx)) {
    await ctx.reply('⛔ غير مصرح لك باستخدام هذا البوت.');
    return;
  }
  let session;
  try {
    await ctx.reply('🚀 جاري تشغيل المتصفح...');
    session = await getSession(ctx);
    await sendScreenshot(ctx, session, 'أهلا بك. استخدم الأزرار للتحكم بالمتصفح. كل إجراء يرسل لقطة شاشة تلقائيا.');
  } catch (error) {
    await sendErrorWithScreenshot(ctx, session, error, 'تشغيل المتصفح');
  }
});

bot.command('menu', async (ctx) => {
  await performAction(ctx, 'إظهار لوحة التحكم', async () => {});
});

bot.command('close', async (ctx) => {
  if (!isAllowed(ctx)) {
    await ctx.reply('⛔ غير مصرح لك باستخدام هذا البوت.');
    return;
  }
  await closeSession(ctx.from.id);
  await ctx.reply('✅ تم إغلاق جلسة المتصفح. أرسل /start لتشغيلها من جديد.');
});

bot.on('callback_query', async (ctx) => {
  if (!isAllowed(ctx)) {
    await ctx.answerCbQuery('غير مصرح', { show_alert: true }).catch(() => {});
    return;
  }

  const data = ctx.callbackQuery?.data || '';
  await ctx.answerCbQuery().catch(() => {});

  let session;
  try {
    session = await getSession(ctx);

    if (data === 'a:cancel') {
      session.pending = null;
      session.mode = 'normal';
      await sendScreenshot(ctx, session, 'تم الإلغاء.');
      return;
    }

    if (data.startsWith('tap:')) {
      const number = Number(data.split(':')[1]);
      await performAction(ctx, `الضغط على المربع ${number}`, async (s) => tapTarget(s, number));
      return;
    }

    if (data.startsWith('filltarget:')) {
      const number = Number(data.split(':')[1]);
      const target = session.targets.find((item) => item.number === number);
      if (!target) throw new Error('هذا الرقم غير موجود في اللقطة الحالية.');
      session.pending = { type: 'fillText', number };
      session.mode = 'normal';
      await ctx.reply(`✍️ أرسل النص الذي تريد وضعه داخل المربع رقم ${number}.\nسيتم مسح الموجود وكتابة النص الجديد بالكامل.`, Markup.inlineKeyboard([
        [Markup.button.callback('إلغاء', 'a:cancel')],
      ]));
      return;
    }

    switch (data) {
      case 'a:open':
        await askForInput(ctx, session, { type: 'open' }, '🌐 أرسل الرابط الذي تريد فتحه.\nمثال: example.com أو https://example.com');
        break;
      case 'a:google':
        await askForInput(ctx, session, { type: 'google' }, '🔎 أرسل كلمة أو جملة البحث في Google. يدعم العربية بالكامل.');
        break;
      case 'a:type':
        await askForInput(ctx, session, { type: 'type' }, '⌨️ أرسل النص الذي تريد كتابته في الحقل المحدد حاليا.\nاضغط أولا على رقم حقل أزرق إذا لم يكن هناك حقل محدد.');
        break;
      case 'a:clicktext':
        await askForInput(ctx, session, { type: 'clickText' }, '👆 أرسل النص الذي تريد البحث عنه والضغط عليه داخل الصفحة.');
        break;
      case 'a:findtext':
        await askForInput(ctx, session, { type: 'findText' }, '🔍 أرسل النص الذي تريد العثور عليه داخل الصفحة. سأعلّمه باللون الأخضر.');
        break;
      case 'a:fillmode':
        session.pending = null;
        session.mode = 'fillTarget';
        await sendScreenshot(ctx, session, '📝 اختر رقم الحقل أو العنصر الذي تريد تعبئته من الأزرار الرقمية بالأسفل.');
        break;
      case 'a:boxes':
        await sendScreenshot(ctx, session, '📦 تم تحديث المربعات. الأزرق للكتابة، والأحمر للضغط.');
        break;
      case 'a:shot':
        await sendScreenshot(ctx, session, '📸 لقطة شاشة جديدة.');
        break;
      case 'a:back':
        await performAction(ctx, 'الرجوع للخلف', async (s) => {
          await s.page.goBack({ waitUntil: 'domcontentloaded', timeout: intEnv('NAVIGATION_TIMEOUT_MS', 60000) }).catch(() => {});
          await waitAfterAction(s.page);
        });
        break;
      case 'a:reload':
        await performAction(ctx, 'تحديث الصفحة', async (s) => {
          await s.page.reload({ waitUntil: 'domcontentloaded', timeout: intEnv('NAVIGATION_TIMEOUT_MS', 60000) });
          await waitAfterAction(s.page);
        });
        break;
      case 'a:scrollup':
        await performAction(ctx, 'السكرول للأعلى', async (s) => {
          await s.page.mouse.wheel(0, -650);
          await waitAfterAction(s.page);
        });
        break;
      case 'a:scrolldown':
        await performAction(ctx, 'السكرول للأسفل', async (s) => {
          await s.page.mouse.wheel(0, 650);
          await waitAfterAction(s.page);
        });
        break;
      case 'a:enter':
        await performAction(ctx, 'الضغط على Enter', async (s) => {
          await s.page.keyboard.press('Enter');
          await waitAfterAction(s.page);
        });
        break;
      case 'a:clear':
        await performAction(ctx, 'مسح الحقل المحدد', clearFocused);
        break;
      default:
        await ctx.reply('لم أفهم هذا الزر. اضغط /menu لإظهار لوحة التحكم.');
    }
  } catch (error) {
    await sendErrorWithScreenshot(ctx, session, error, 'تنفيذ الزر');
  }
});

bot.on('text', async (ctx) => {
  if (!isAllowed(ctx)) {
    await ctx.reply('⛔ غير مصرح لك باستخدام هذا البوت.');
    return;
  }

  const text = ctx.message.text || '';
  if (text.startsWith('/')) return;

  let session;
  try {
    session = await getSession(ctx);
    const pending = session.pending;

    if (!pending) {
      await sendScreenshot(ctx, session, 'استخدم الأزرار للتحكم. إذا ضغطت زر يحتاج نصا، أرسل النص هنا بعدها مباشرة.');
      return;
    }

    session.pending = null;

    if (pending.type === 'open') {
      await session.page.goto(normalizeUrl(text), { waitUntil: 'domcontentloaded', timeout: intEnv('NAVIGATION_TIMEOUT_MS', 60000) });
      await waitAfterAction(session.page);
      await sendScreenshot(ctx, session, '✅ تم فتح الرابط.');
      return;
    }

    if (pending.type === 'google') {
      const url = `https://www.google.com/search?q=${encodeURIComponent(text.trim())}`;
      await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: intEnv('NAVIGATION_TIMEOUT_MS', 60000) });
      await waitAfterAction(session.page);
      await sendScreenshot(ctx, session, `✅ تم البحث عن: ${truncate(text, 80)}`);
      return;
    }

    if (pending.type === 'type') {
      await typeFocused(session, text);
      await sendScreenshot(ctx, session, '✅ تم إدخال النص في الحقل المحدد.');
      return;
    }

    if (pending.type === 'fillText') {
      await fillTarget(session, pending.number, text);
      await sendScreenshot(ctx, session, `✅ تم تعبئة المربع رقم ${pending.number}.`);
      return;
    }

    if (pending.type === 'findText') {
      await findOrClickText(session, text, false);
      await sendScreenshot(ctx, session, `✅ تم العثور على النص: ${truncate(text, 80)}`);
      return;
    }

    if (pending.type === 'clickText') {
      await findOrClickText(session, text, true);
      await sendScreenshot(ctx, session, `✅ تم الضغط على النص: ${truncate(text, 80)}`);
      return;
    }

    await sendScreenshot(ctx, session, 'لم أفهم الإدخال الحالي. استخدم الأزرار من لوحة التحكم.');
  } catch (error) {
    if (session) session.pending = null;
    await sendErrorWithScreenshot(ctx, session, error, 'معالجة النص');
  }
});

process.once('SIGINT', async () => {
  await bot.stop('SIGINT');
  for (const session of sessions.values()) await session.context.close().catch(() => {});
  process.exit(0);
});

process.once('SIGTERM', async () => {
  await bot.stop('SIGTERM');
  for (const session of sessions.values()) await session.context.close().catch(() => {});
  process.exit(0);
});

startHealthServer();
bot.launch()
  .then(() => {
    console.log('Telegram browser bot started.');
    if (allowedUserIds().length === 0 || allowedUserIds().includes('PUT_YOUR_TELEGRAM_USER_ID_HERE')) {
      console.warn('تحذير: ALLOWED_USER_IDS غير مضبوط. أي شخص يعرف البوت قد يستخدمه.');
    }
  })
  .catch((error) => {
    console.error('Failed to launch bot:', error);
    process.exit(1);
  });
