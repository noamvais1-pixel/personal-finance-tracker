import { startServer } from './server.js';
import { startScheduler } from './scheduler.js';
import { log } from './config.js';

process.on('unhandledRejection', e => log('unhandledRejection', e?.stack || e));
process.on('uncaughtException', e => log('uncaughtException', e?.stack || e));

await startServer();
startScheduler();
