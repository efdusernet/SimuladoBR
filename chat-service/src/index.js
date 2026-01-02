const { createApp } = require('./app');
const { env } = require('./config/env');
const { attachAdminWebSocketServer } = require('./realtime/adminWs');

async function main() {
  const app = createApp();

  const server = app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[chat-service] listening on :${env.PORT}`);
  });

  attachAdminWebSocketServer(server);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[chat-service] fatal error', err);
  process.exitCode = 1;
});
