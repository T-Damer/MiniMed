/** `bun src/cli.ts invite` — prints a new one-time invite code for a doctor's sign-up. */
import { inviteProof, inviteStorageKey } from '@localmed/diary-sync';
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
// Only the hash of the code's proof is stored: an access code is also its account's password.
await store.createInvite(await inviteStorageKey(await inviteProof(code)), now());
console.info(code);
