'use strict';

const dns = require('dns');
const path = require('path');
const dotenv = require('dotenv');

// Robust DNS resolution for cloud SRV lookups (Windows/local networks that
// refuse SRV queries via the system resolver). Skipped on Render, which sets
// RENDER=true and whose platform resolver handles Atlas SRV correctly.
if (process.env.RENDER !== 'true') {
  try {
    dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
  } catch {
    /* keep system defaults */
  }
}

dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });
dotenv.config({ path: path.join(__dirname, '.env.local'), quiet: true });

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const mongoose = require('mongoose');

const { requireDbConfig, assertRuntimeEnv, corsOrigins } = require('./config/env');
const { connectDB } = require('./db/connect');
const apiRouter = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const VERSION = require('./package.json').version;

function healthHandler(req, res) {
  res.json({
    success: true,
    status: 'ok',
    service: 'bmit-backend',
    version: VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
}

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', Number(process.env.TRUST_PROXY || 0));

  app.use(helmet());

  const allowed = corsOrigins();

  // Active CORS allowlist: requests carrying a disallowed Origin are rejected outright.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !allowed.includes(origin)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_ORIGIN', message: 'Origin not allowed.' },
      });
    }
    return next();
  });

  app.use(
    cors({
      origin: (origin, callback) => callback(null, !origin || allowed.includes(origin)),
      credentials: false,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  app.use(express.json({ limit: '50kb' }));

  app.get('/', healthHandler);
  app.get('/health', healthHandler);
  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/**
 * Boot sequence: validate configuration FIRST (fail fast, no in-memory fallback),
 * then connect to the explicitly configured MongoDB, then listen.
 */
async function startServer(port = process.env.PORT || 5000) {
  const uri = requireDbConfig();
  assertRuntimeEnv();
  await connectDB(uri);

  const app = createApp();
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(Number(port), () => resolve(instance));
    instance.once('error', reject);
  });

  return { app, server };
}

/**
 * Graceful shutdown for Render (SIGTERM on deploy/restart): stop accepting new
 * connections, drop idle keep-alive sockets, let in-flight requests finish,
 * close MongoDB, then exit. 10s failsafe forces exit if drain hangs.
 */
function attachGracefulShutdown(server) {
  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    // eslint-disable-next-line no-console
    console.log(`[bmit-backend] ${signal} received — draining connections`);
    server.close(() => {
      mongoose.connection
        .close()
        .catch(() => {})
        .finally(() => process.exit(0));
    });
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  startServer()
    .then(({ server }) => {
      const address = server.address();
      attachGracefulShutdown(server);
      // eslint-disable-next-line no-console
      console.log(`[bmit-backend] listening on port ${address.port}`);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[bmit-backend] FATAL: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { createApp, startServer, attachGracefulShutdown };
