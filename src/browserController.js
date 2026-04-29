const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function safeFilePart(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

class BrowserController {
  constructor(config) {
    this.config = config;
    this.sessions = new Map();
    fs.mkdirSync(this.config.profilesDir, { recursive: true });
  }

  async getSession(userId) {
    const key = String(userId);
    const current = this.sessions.get(key);
    if (current && current.page && !current.page.isClosed()) return current;

    const profileDir = path.join(this.config.profilesDir, `user-${safeFilePart(key)}`);
    fs.mkdirSync(profileDir, { recursive: true });

    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      ...this.config.browserArgs
    ];

    const launchOptions = {
      headless: this.config.headless,
      viewport: {
        width: this.config.viewportWidth,
        height: this.config.viewportHeight
      },
      deviceScaleFactor: this.config.deviceScaleFactor,
      locale: this.config.locale,
      timezoneId: this.config.timezoneId,
      ignoreHTTPSErrors: true,
      args,
      slowMo: this.config.slowMo
    };

    if (this.config.browserExecutablePath) {
      launchOptions.executablePath = this.config.browserExecutablePath;
    }

    if (this.config.proxyServer) {
      launchOptions.proxy = { server: this.config.proxyServer };
      if (this.config.proxyUsername) launchOptions.proxy.username = this.config.proxyUsername;
      if (this.config.proxyPassword) launchOptions.proxy.password = this.config.proxyPassword;
    }

    const context = await chromium.launchPersistentContext(profileDir, launchOptions);
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(this.config.navigationTimeoutMs);
    page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);

    const session = { context, page, targets: [], userId: key };
    this.sessions.set(key, session);

    if (this.config.defaultStartUrl) {
      await page.goto(this.config.defaultStartUrl, { waitUntil: 'domcontentloaded', timeout: this.config.navigationTimeoutMs }).catch(() => null);
      await this.settle(page);
    }

    return session;
  }

  async settle(page) {
    await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => null);
    if (this.config.actionDelayMs > 0) await sleep(this.config.actionDelayMs);
  }

  async removeOverlay(userId) {
    const session = await this.getSession(userId);
    await session.page.evaluate(() => {
      const old = document.getElementById('__tbb_overlay__');
      if (old) old.remove();
      document.querySelectorAll('[data-tbb-found="1"]').forEach((el) => {
        el.style.outline = el.getAttribute('data-tbb-old-outline') || '';
        el.removeAttribute('data-tbb-old-outline');
        el.removeAttribute('data-tbb-found');
      });
    }).catch(() => null);
  }

  async scanTargets(userId, withOverlay = true) {
    const session = await this.getSession(userId);
    const page = session.page;
    const maxTargets = this.config.maxTargets;

    const targets = await page.evaluate(({ maxTargets, withOverlay }) => {
      const oldOverlay = document.getElementById('__tbb_overlay__');
      if (oldOverlay) oldOverlay.remove();
      document.querySelectorAll('[data-tbb-id]').forEach((el) => el.removeAttribute('data-tbb-id'));

      const selector = [
        'a[href]',
        'button',
        'input',
        'textarea',
        'select',
        '[role="button"]',
        '[role="link"]',
        '[onclick]',
        '[contenteditable="true"]',
        '[tabindex]:not([tabindex="-1"])'
      ].join(',');

      const seen = new Set();
      const candidates = Array.from(document.querySelectorAll(selector)).filter((el) => {
        if (seen.has(el)) return false;
        seen.add(el);
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        if (rect.width < 4 || rect.height < 4) return false;
        if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) return false;
        return true;
      });

      const targets = [];
      for (const el of candidates) {
        if (targets.length >= maxTargets) break;
        const rect = el.getBoundingClientRect();
        const id = targets.length + 1;
        el.setAttribute('data-tbb-id', String(id));
        const tag = (el.tagName || '').toLowerCase();
        const role = el.getAttribute('role') || '';
        const inputType = el.getAttribute('type') || '';
        const text = (
          el.innerText ||
          el.value ||
          el.getAttribute('aria-label') ||
          el.getAttribute('placeholder') ||
          el.getAttribute('title') ||
          el.getAttribute('href') ||
          tag
        ).replace(/\s+/g, ' ').trim().slice(0, 90);
        const editable = tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
        targets.push({
          id,
          tag,
          role,
          inputType,
          text,
          editable,
          x: Math.max(0, Math.round(rect.left)),
          y: Math.max(0, Math.round(rect.top)),
          w: Math.round(rect.width),
          h: Math.round(rect.height)
        });
      }

      if (withOverlay) {
        const overlay = document.createElement('div');
        overlay.id = '__tbb_overlay__';
        overlay.style.position = 'fixed';
        overlay.style.left = '0';
        overlay.style.top = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.zIndex = '2147483647';
        overlay.style.pointerEvents = 'none';
        overlay.style.fontFamily = 'Arial, sans-serif';

        for (const target of targets) {
          const box = document.createElement('div');
          box.style.position = 'fixed';
          box.style.left = `${target.x}px`;
          box.style.top = `${target.y}px`;
          box.style.width = `${Math.max(8, target.w)}px`;
          box.style.height = `${Math.max(8, target.h)}px`;
          box.style.border = target.editable ? '3px solid #0066ff' : '3px solid #ff0033';
          box.style.borderRadius = '6px';
          box.style.boxSizing = 'border-box';
          box.style.background = 'rgba(255,255,255,0.04)';

          const label = document.createElement('div');
          label.textContent = String(target.id);
          label.style.position = 'absolute';
          label.style.left = '-2px';
          label.style.top = '-24px';
          label.style.minWidth = '22px';
          label.style.height = '22px';
          label.style.padding = '0 5px';
          label.style.borderRadius = '11px';
          label.style.background = target.editable ? '#0066ff' : '#ff0033';
          label.style.color = '#fff';
          label.style.fontWeight = '700';
          label.style.fontSize = '14px';
          label.style.lineHeight = '22px';
          label.style.textAlign = 'center';
          label.style.boxShadow = '0 2px 8px rgba(0,0,0,0.35)';
          box.appendChild(label);
          overlay.appendChild(box);
        }

        document.documentElement.appendChild(overlay);
      }

      return targets;
    }, { maxTargets, withOverlay });

    session.targets = targets;
    return targets;
  }

  async screenshot(userId, options = {}) {
    const session = await this.getSession(userId);
    const withBoxes = options.withBoxes ?? this.config.showBoxesAfterEachAction;
    let targets = session.targets;
    if (withBoxes) {
      targets = await this.scanTargets(userId, true);
    } else {
      await this.removeOverlay(userId);
    }

    const buffer = await session.page.screenshot({ type: 'png', fullPage: false });
    const info = await this.info(userId);
    return { buffer, targets, ...info };
  }

  async info(userId) {
    const session = await this.getSession(userId);
    const page = session.page;
    const title = await page.title().catch(() => '');
    const url = page.url();
    return { title, url };
  }

  async open(userId, inputUrl) {
    const session = await this.getSession(userId);
    const url = normalizeUrl(inputUrl);
    if (!url) throw new Error('اكتب الرابط بعد الأمر. مثال: /open example.com');
    await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.config.navigationTimeoutMs });
    await this.settle(session.page);
  }

  async google(userId, query) {
    const text = String(query || '').trim();
    if (!text) throw new Error('اكتب كلمات البحث بعد الأمر. مثال: /google openai');
    const url = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
    await this.open(userId, url);
  }

  async clickTarget(userId, targetId) {
    const session = await this.getSession(userId);
    const id = Number.parseInt(String(targetId), 10);
    if (!Number.isFinite(id) || id < 1) throw new Error('رقم العنصر غير صحيح. مثال: /tap 3');
    if (!session.targets.length) await this.scanTargets(userId, true);
    const locator = session.page.locator(`[data-tbb-id="${id}"]`).first();
    await locator.scrollIntoViewIfNeeded().catch(() => null);
    await locator.click({ timeout: 10000 });
    await this.settle(session.page);
  }

  async fillTarget(userId, targetId, text) {
    const session = await this.getSession(userId);
    const id = Number.parseInt(String(targetId), 10);
    if (!Number.isFinite(id) || id < 1) throw new Error('رقم الحقل غير صحيح. مثال: /fill 5 hello');
    if (!session.targets.length) await this.scanTargets(userId, true);
    const locator = session.page.locator(`[data-tbb-id="${id}"]`).first();
    await locator.scrollIntoViewIfNeeded().catch(() => null);
    await locator.fill(String(text || ''), { timeout: 10000 }).catch(async () => {
      await locator.click({ timeout: 5000 });
      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await session.page.keyboard.press(`${modifier}+A`).catch(() => null);
      await session.page.keyboard.press('Backspace').catch(() => null);
      await session.page.keyboard.type(String(text || ''), { delay: 20 });
    });
    await this.settle(session.page);
  }

  async clearTarget(userId, targetId) {
    await this.fillTarget(userId, targetId, '');
  }

  async typeText(userId, text) {
    const session = await this.getSession(userId);
    const value = String(text || '');
    if (!value) throw new Error('اكتب النص بعد الأمر. مثال: /type hello');
    await session.page.keyboard.type(value, { delay: 20 });
    await this.settle(session.page);
  }

  async press(userId, key) {
    const session = await this.getSession(userId);
    const value = String(key || '').trim();
    if (!value) throw new Error('اكتب اسم الزر. مثال: /press Enter');
    await session.page.keyboard.press(value);
    await this.settle(session.page);
  }

  async scroll(userId, direction) {
    const session = await this.getSession(userId);
    const normalized = String(direction || 'down').toLowerCase();
    const amount = normalized.includes('up') || normalized.includes('فوق') ? -650 : 650;
    await session.page.mouse.wheel(0, amount);
    await this.settle(session.page);
  }

  async back(userId) {
    const session = await this.getSession(userId);
    await session.page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null);
    await this.settle(session.page);
  }

  async forward(userId) {
    const session = await this.getSession(userId);
    await session.page.goForward({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null);
    await this.settle(session.page);
  }

  async reload(userId) {
    const session = await this.getSession(userId);
    await session.page.reload({ waitUntil: 'domcontentloaded', timeout: this.config.navigationTimeoutMs });
    await this.settle(session.page);
  }

  async findText(userId, text) {
    const session = await this.getSession(userId);
    const query = String(text || '').trim();
    if (!query) throw new Error('اكتب النص المراد البحث عنه. مثال: /find login');

    const result = await session.page.evaluate((query) => {
      const old = document.querySelectorAll('[data-tbb-found="1"]');
      old.forEach((el) => {
        el.style.outline = el.getAttribute('data-tbb-old-outline') || '';
        el.removeAttribute('data-tbb-old-outline');
        el.removeAttribute('data-tbb-found');
      });

      const needle = query.toLowerCase();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const value = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
        if (value && value.toLowerCase().includes(needle)) {
          const el = node.parentElement;
          if (el) {
            el.scrollIntoView({ block: 'center', inline: 'center' });
            el.setAttribute('data-tbb-old-outline', el.style.outline || '');
            el.setAttribute('data-tbb-found', '1');
            el.style.outline = '4px solid #00c853';
            return { found: true, text: value.slice(0, 120) };
          }
        }
        node = walker.nextNode();
      }
      return { found: false };
    }, query);

    await this.settle(session.page);
    return result;
  }

  async clickText(userId, text) {
    const session = await this.getSession(userId);
    const query = String(text || '').trim();
    if (!query) throw new Error('اكتب النص المراد الضغط عليه. مثال: /clicktext Sign in');
    await session.page.getByText(query, { exact: false }).first().click({ timeout: 10000 });
    await this.settle(session.page);
  }

  async closeSession(userId) {
    const key = String(userId);
    const session = this.sessions.get(key);
    if (!session) return;
    await session.context.close().catch(() => null);
    this.sessions.delete(key);
  }

  async closeAll() {
    const entries = Array.from(this.sessions.keys());
    for (const key of entries) {
      await this.closeSession(key);
    }
  }
}

module.exports = { BrowserController, normalizeUrl };
