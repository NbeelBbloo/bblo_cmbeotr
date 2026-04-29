const { config } = require('./config');
const { startHealthServer } = require('./healthServer');
const { BrowserController } = require('./browserController');
const { TelegramBrowserBot } = require('./telegramBot');

async function main() {
  if (!config.telegramToken) {
    console.error('Missing TELEGRAM_BOT_TOKEN. Add it to Railway Variables.');
    process.exit(1);
  }

  startHealthServer(config);

  const controller = new BrowserController(config);
  const telegram = new TelegramBrowserBot(config, controller);
  telegram.start();

  const shutdown = async (signal) => {
    console.log(`[shutdown] received ${signal}`);
    await controller.closeAll().catch(() => null);
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('[fatal]', error);
  process.exit(1);
});
