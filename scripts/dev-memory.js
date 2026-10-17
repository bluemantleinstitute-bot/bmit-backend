'use strict';

/**
 * TEST/DEV ONLY — boots the API against an in-memory MongoDB for local
 * development and smoke tests.
 *
 * This is NOT a production fallback: production runs `npm start` → server.js,
 * which fails fast (DB_CONFIG_MISSING) when MONGODB_URI is absent. This runner
 * deliberately injects a memory-server URI only into this process.
 *
 * Usage: node scripts/dev-memory.js   (or: npm run dev-memory)
 */

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });

const { MongoMemoryServer } = require('mongodb-memory-server');

(async () => {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('bmit_dev');

  const { startServer } = require('../server');
  const { server } = await startServer(Number(process.env.PORT) || 5000);

  const { seed } = require('./seed');
  const result = await seed(process.env.MONGODB_URI);

  // eslint-disable-next-line no-console
  console.log(
    `[dev-memory] listening on port ${server.address().port} — seeded ${result.inserted} records (${result.total} total)`
  );

  const shutdown = async () => {
    server.close();
    await mongo.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[dev-memory] FATAL: ${err.message}`);
  process.exit(1);
});
