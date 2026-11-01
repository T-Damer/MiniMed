/** `bun src/cli.ts invite` — prints a new one-time invite code for a doctor's sign-up. */
import { readSettings } from './config';
import { newInviteCode } from './invites';
import { openDatabase, SqliteStore } from './sqlite-store';
import { now } from './store';

const [command] = process.argv.slice(2);
if (command !== 'invite') {
  console.error('Usage: bun src/cli.ts invite');
  process.exit(1);
}
// The server mode's database; a serverless deployment makes invites with serverless-cli.ts.
const store = new SqliteStore(openDatabase(readSettings().database));
const code = newInviteCode();
await store.createInvite(code, now());
console.info(code);
