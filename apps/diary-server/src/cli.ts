/** `bun src/cli.ts invite` — prints a new one-time invite code for a doctor's sign-up. */
import { readSettings } from './config';
import { now, openDatabase } from './db';
import { newInviteCode } from './invites';

const [command] = process.argv.slice(2);
if (command !== 'invite') {
  console.error('Usage: bun src/cli.ts invite');
  process.exit(1);
}
const db = openDatabase(readSettings().database);
const code = newInviteCode();
db.query('INSERT INTO invites (code, created_at) VALUES (?, ?)').run(code, now());
console.info(code);
