const express = require('express');

function startHealthServer(config) {
  const app = express();

  app.get('/', (_req, res) => {
    res.status(200).json({ ok: true, service: 'telegram-browser-bot' });
  });

  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true, uptime: process.uptime() });
  });

  app.listen(config.port, () => {
    console.log(`[health] listening on port ${config.port}`);
  });
}

module.exports = { startHealthServer };
