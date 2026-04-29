const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

function env(name, fallback = '') {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  return value;
}

function boolEnv(name, fallback = false) {
  const value = env(name, String(fallback)).toLowerCase().trim();
  return ['1', 'true', 'yes', 'y', 'on'].includes(value);
}

function intEnv(name, fallback) {
  const parsed = Number.parseInt(env(name, String(fallback)), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitArgs(raw) {
  if (!raw) return [];
  const matches = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return matches.map((item) => item.replace(/^['"]|['"]$/g, ''));
}

function parseAllowedUsers(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

const config = {
  telegramToken: env('TELEGRAM_BOT_TOKEN'),
  allowedUserIds: parseAllowedUsers(env('ALLOWED_USER_IDS')),
  port: intEnv('PORT', 3000),
  headless: boolEnv('HEADLESS', true),
  defaultStartUrl: env('DEFAULT_START_URL', 'https://www.google.com'),
  viewportWidth: intEnv('VIEWPORT_WIDTH', 1365),
  viewportHeight: intEnv('VIEWPORT_HEIGHT', 768),
  deviceScaleFactor: intEnv('DEVICE_SCALE_FACTOR', 1),
  maxTargets: intEnv('MAX_TARGETS', 30),
  showBoxesAfterEachAction: boolEnv('SHOW_BOXES_AFTER_EACH_ACTION', true),
  navigationTimeoutMs: intEnv('NAVIGATION_TIMEOUT_MS', 60000),
  actionDelayMs: intEnv('ACTION_DELAY_MS', 400),
  slowMo: intEnv('SLOW_MO', 0),
  timezoneId: env('TIMEZONE_ID', 'Asia/Baghdad'),
  locale: env('LOCALE', 'ar-IQ'),
  browserExecutablePath: env('BROWSER_EXECUTABLE_PATH'),
  browserArgs: splitArgs(env('BROWSER_ARGS')),
  proxyServer: env('PROXY_SERVER'),
  proxyUsername: env('PROXY_USERNAME'),
  proxyPassword: env('PROXY_PASSWORD'),
  profilesDir: path.join(process.cwd(), 'profiles')
};

module.exports = { config };
