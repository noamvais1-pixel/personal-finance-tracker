// Runs one automatic sync a day (after the configured hour), plus a catch-up shortly after startup
// when the last successful sync is old. Nothing runs before the user saved at least one login.
import { db, getSetting } from './db.js';
import { log } from './config.js';
import { runSync, syncState, configuredCompanies } from './sync.js';

function lastOkSync() {
  return db.prepare('SELECT MAX(finished_at) AS t FROM sync_log WHERE ok = 1').get()?.t || null;
}
function lastAttempt() {
  return db.prepare('SELECT MAX(started_at) AS t FROM sync_log').get()?.t || null;
}

function shouldRunNow() {
  if (syncState.running || !configuredCompanies().length) return false;
  const hour = Number(getSetting('syncHour', 7));
  const nowD = new Date();
  const todayKey = nowD.toLocaleDateString('en-CA');            // YYYY-MM-DD local
  const last = lastOkSync();
  const lastKey = last ? new Date(last).toLocaleDateString('en-CA') : null;
  if (lastKey === todayKey) return false;                        // already done today
  if (nowD.getHours() < hour) return false;                      // too early
  // do not hammer a failing site: at most one attempt per 2 hours
  const attempt = lastAttempt();
  if (attempt && Date.now() - new Date(attempt).getTime() < 2 * 3600_000) return false;
  return true;
}

export function startScheduler() {
  setTimeout(() => { if (shouldRunNow()) runSync({ reason: 'startup' }).catch(e => log('startup sync error', e)); }, 15_000);
  setInterval(() => { if (shouldRunNow()) runSync({ reason: 'scheduled' }).catch(e => log('scheduled sync error', e)); }, 5 * 60_000);
}
