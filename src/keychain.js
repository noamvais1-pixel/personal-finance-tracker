// Bank passwords live in the macOS Keychain, never in a plain file.
// Each institution is one "generic password" item; the secret is a small JSON with the login fields.
import { spawnSync } from 'node:child_process';
import { KEYCHAIN_SERVICE } from './config.js';

function quote(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

export function setCredentials(company, fields) {
  const secret = JSON.stringify(fields);
  // Interactive mode reads the command from stdin, so the password never shows up in the process list.
  const cmd = `add-generic-password -U -a ${quote(company)} -s ${quote(KEYCHAIN_SERVICE)} -l ${quote('מעקב כספים - ' + company)} -w ${quote(secret)}\n`;
  const r = spawnSync('security', ['-i'], { input: cmd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`Keychain write failed: ${r.stderr || r.stdout}`);
}

export function getCredentials(company) {
  const r = spawnSync('security', ['find-generic-password', '-a', company, '-s', KEYCHAIN_SERVICE, '-w'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout.trim()); } catch { return null; }
}

export function hasCredentials(company) {
  const r = spawnSync('security', ['find-generic-password', '-a', company, '-s', KEYCHAIN_SERVICE], { encoding: 'utf8' });
  return r.status === 0;
}

export function deleteCredentials(company) {
  spawnSync('security', ['delete-generic-password', '-a', company, '-s', KEYCHAIN_SERVICE], { encoding: 'utf8' });
}
