// Runs one sync from the terminal (useful for debugging): npm run sync [-- hapoalim|max]
import { runSync } from './sync.js';
const companies = process.argv.slice(2);
const r = await runSync({ companies: companies.length ? companies : undefined, reason: 'cli' });
console.log(JSON.stringify(r, null, 2));
process.exit(0);
