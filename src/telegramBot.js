const TelegramBot = require('node-telegram-bot-api');

function chunk(array, size) {
  const rows = [];
  for (let i = 0; i < array.length; i += size) rows.push(array.slice(i, i + size));
  return rows;
}

function trimCaption(text) {
  const value = String(text || '');
  if (value.length <= 900) return value;
  return `${value.slice(0, 897)}...`;
}

function makeKeyboard(targets = []) {
  const keyboard = [
    [
      { text: 'Back', callback_data: 'nav:back' },
      { text: 'Reload', callback_data: 'nav:reload' },
      { text: 'Boxes', callback_data: 'nav:boxes' },
      { text: 'Shot', callback_data: 'nav:shot' }
    ],
    [
      { text: 'Scroll Up', callback_data: 'scroll:up' },
      { text: 'Scroll Down', callback_data: 'scroll:down' },
      { text: 'Forward', callback_data: 'nav:forward' }
    ]
  ];

  const targetButtons = targets.map((target) => {
    const prefix = target.editable ? 'Edit ' : '';
    return { text: `${prefix}${target.id}`, callback_data: `tap:${target.id}` };
  });

  for (const row of chunk(targetButtons, 5)) keyboard.push(row);
  return { inline_keyboard: keyboard };
}

function targetSummary(targets = []) {
  if (!targets.length) return 'No visible targets found.';
  return targets
    .slice(0, 12)
    .map((target) => {
      const editable = target.editable ? ' [field]' : '';
      const label = target.text || `${target.tag}${target.inputType ? `:${target.inputType}` : ''}`;
      return `${target.id}. ${label}${editable}`;
    })
    .join('\n');
}

function getCommandText(msg) {
  return String(msg.text || '').trim();
}

function stripCommand(text) {
  const firstSpace = text.indexOf(' ');
  if (firstSpace === -1) return '';
  return text.slice(firstSpace + 1).trim();
}

function parseIdAndText(raw) {
  const match = String(raw || '').trim().match(/^(\d+)\s*([\s\S]*)$/);
  if (!match) return null;
  return { id: Number.parseInt(match[1], 10), text: match[2] || '' };
}

function helpText() {
  return [
    'Telegram Browser Bot',
    '',
    'Basic:',
    '/open example.com - open website',
    '/google search words - Google search',
    '/shot - screenshot',
    '/boxes - show numbered clickable boxes',
    '/url - show current URL',
    '',
    'Control:',
    '/tap 3 - click target number 3',
    '/fill 5 hello - clear field 5 and type text',
    '/type hello - type into focused field',
    '/clear 5 - clear field 5',
    '/press Enter - press keyboard key',
    '/scroll down - scroll page',
    '/back - browser back',
    '/forward - browser forward',
    '/reload - reload page',
    '',
    'Text search:',
    '/find text - find and highlight text',
    '/clicktext text - click visible text',
    '',
    'Session:',
    '/close - close browser session',
    '',
    'Tip: blue boxes are fields. Red boxes are clickable elements.'
  ].join('\n');
}

class TelegramBrowserBot {
  constructor(config, browserController) {
    this.config = config;
    this.browser = browserController;
    this.bot = new TelegramBot(config.telegramToken, { polling: true });
    this.busy = new Set();
  }

  isAllowed(msgOrQuery) {
    const from = msgOrQuery.from || (msgOrQuery.message && msgOrQuery.message.from);
    if (!from) return false;
    if (!this.config.allowedUserIds.length) return true;
    return this.config.allowedUserIds.includes(String(from.id));
  }

  async rejectUnauthorized(chatId) {
    await this.bot.sendMessage(chatId, 'Unauthorized. Add your Telegram user id to ALLOWED_USER_IDS in Railway variables.');
  }

  async withLock(userId, fn) {
    const key = String(userId);
    if (this.busy.has(key)) {
      throw new Error('The browser is still processing the previous command. Try again in a moment.');
    }
    this.busy.add(key);
    try {
      return await fn();
    } finally {
      this.busy.delete(key);
    }
  }

  async sendShot(chatId, userId, caption = 'Screenshot', withBoxes = this.config.showBoxesAfterEachAction) {
    const shot = await this.browser.screenshot(userId, { withBoxes });
    const lines = [
      caption,
      '',
      `Title: ${shot.title || '-'}`,
      `URL: ${shot.url || '-'}`
    ];

    if (withBoxes) {
      lines.push('', 'Targets:', targetSummary(shot.targets));
    }

    await this.bot.sendPhoto(chatId, shot.buffer, {
      caption: trimCaption(lines.join('\n')),
      reply_markup: makeKeyboard(shot.targets)
    });
  }

  async handleMessage(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = getCommandText(msg);

    if (!this.isAllowed(msg)) {
      await this.rejectUnauthorized(chatId);
      return;
    }

    if (!text.startsWith('/')) return;

    try {
      await this.withLock(userId, async () => {
        const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();
        const rest = stripCommand(text);

        switch (command) {
          case '/start':
          case '/help':
            await this.bot.sendMessage(chatId, helpText());
            await this.sendShot(chatId, userId, 'Browser opened.', true);
            break;

          case '/open':
            await this.browser.open(userId, rest);
            await this.sendShot(chatId, userId, 'Opened page.', true);
            break;

          case '/google':
            await this.browser.google(userId, rest);
            await this.sendShot(chatId, userId, 'Google search results.', true);
            break;

          case '/shot':
            await this.sendShot(chatId, userId, 'Screenshot.', false);
            break;

          case '/boxes':
            await this.browser.scanTargets(userId, true);
            await this.sendShot(chatId, userId, 'Numbered boxes updated.', true);
            break;

          case '/tap':
            await this.browser.clickTarget(userId, rest);
            await this.sendShot(chatId, userId, `Clicked target ${rest}.`, true);
            break;

          case '/fill': {
            const parsed = parseIdAndText(rest);
            if (!parsed) throw new Error('Usage: /fill 5 your text');
            await this.browser.fillTarget(userId, parsed.id, parsed.text);
            await this.sendShot(chatId, userId, `Filled target ${parsed.id}.`, true);
            break;
          }

          case '/clear':
            await this.browser.clearTarget(userId, rest);
            await this.sendShot(chatId, userId, `Cleared target ${rest}.`, true);
            break;

          case '/type':
            await this.browser.typeText(userId, rest);
            await this.sendShot(chatId, userId, 'Typed text.', true);
            break;

          case '/press':
            await this.browser.press(userId, rest);
            await this.sendShot(chatId, userId, `Pressed ${rest}.`, true);
            break;

          case '/scroll':
            await this.browser.scroll(userId, rest || 'down');
            await this.sendShot(chatId, userId, `Scrolled ${rest || 'down'}.`, true);
            break;

          case '/back':
            await this.browser.back(userId);
            await this.sendShot(chatId, userId, 'Back.', true);
            break;

          case '/forward':
            await this.browser.forward(userId);
            await this.sendShot(chatId, userId, 'Forward.', true);
            break;

          case '/reload':
            await this.browser.reload(userId);
            await this.sendShot(chatId, userId, 'Reloaded.', true);
            break;

          case '/find': {
            const result = await this.browser.findText(userId, rest);
            await this.sendShot(chatId, userId, result.found ? `Found: ${result.text}` : 'Text not found.', true);
            break;
          }

          case '/clicktext':
            await this.browser.clickText(userId, rest);
            await this.sendShot(chatId, userId, `Clicked text: ${rest}`, true);
            break;

          case '/url': {
            const info = await this.browser.info(userId);
            await this.bot.sendMessage(chatId, `Title: ${info.title || '-'}\nURL: ${info.url || '-'}`);
            break;
          }

          case '/close':
            await this.browser.closeSession(userId);
            await this.bot.sendMessage(chatId, 'Browser session closed. Send /start to open a new one.');
            break;

          default:
            await this.bot.sendMessage(chatId, helpText());
            break;
        }
      });
    } catch (error) {
      await this.bot.sendMessage(chatId, `Error: ${error.message || error}`);
    }
  }

  async handleCallback(query) {
    const msg = query.message;
    const chatId = msg.chat.id;
    const userId = query.from.id;
    const data = query.data || '';

    if (!this.isAllowed(query)) {
      await this.bot.answerCallbackQuery(query.id, { text: 'Unauthorized', show_alert: true });
      return;
    }

    try {
      await this.bot.answerCallbackQuery(query.id);
      await this.withLock(userId, async () => {
        if (data.startsWith('tap:')) {
          const id = data.split(':')[1];
          await this.browser.clickTarget(userId, id);
          await this.sendShot(chatId, userId, `Clicked target ${id}.`, true);
          return;
        }

        switch (data) {
          case 'nav:back':
            await this.browser.back(userId);
            await this.sendShot(chatId, userId, 'Back.', true);
            break;
          case 'nav:forward':
            await this.browser.forward(userId);
            await this.sendShot(chatId, userId, 'Forward.', true);
            break;
          case 'nav:reload':
            await this.browser.reload(userId);
            await this.sendShot(chatId, userId, 'Reloaded.', true);
            break;
          case 'nav:boxes':
            await this.browser.scanTargets(userId, true);
            await this.sendShot(chatId, userId, 'Numbered boxes updated.', true);
            break;
          case 'nav:shot':
            await this.sendShot(chatId, userId, 'Screenshot.', false);
            break;
          case 'scroll:up':
            await this.browser.scroll(userId, 'up');
            await this.sendShot(chatId, userId, 'Scrolled up.', true);
            break;
          case 'scroll:down':
            await this.browser.scroll(userId, 'down');
            await this.sendShot(chatId, userId, 'Scrolled down.', true);
            break;
          default:
            await this.bot.sendMessage(chatId, 'Unknown button.');
            break;
        }
      });
    } catch (error) {
      await this.bot.sendMessage(chatId, `Error: ${error.message || error}`);
    }
  }

  start() {
    this.bot.on('message', (msg) => this.handleMessage(msg));
    this.bot.on('callback_query', (query) => this.handleCallback(query));
    this.bot.on('polling_error', (error) => {
      console.error('[telegram polling_error]', error.message || error);
    });
    console.log('[telegram] bot polling started');
  }
}

module.exports = { TelegramBrowserBot };
