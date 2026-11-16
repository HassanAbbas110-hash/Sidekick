// Runs tests/live/privacy-live.sql on the linked Supabase project and reports each check.
// The SQL always rolls itself back; this only reads the results out of its final message.
// Needs: `npx supabase login` and `npx supabase link` done once on this machine.
import { execFileSync } from 'node:child_process';

let out = '';
try {
  out = execFileSync('npx', ['-y', 'supabase@2', 'db', 'query', '--linked', '-f', 'tests/live/privacy-live.sql'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
} catch (e) {
  out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
}

// The results JSON is escaped once by the API and once more by the CLI's JSON error output.
const unescaped = out.replaceAll('\\\\\\"', '"').replaceAll('\\"', '"');
const match = unescaped.match(/LIVE_RESULTS (\{[^}]*\})/);
if (!match) {
  console.error(`Live check did not produce results. Output was:\n${out}`);
  process.exit(1);
}
const { total, passed, failed } = JSON.parse(match[1]);
for (const name of failed) console.log(`FAIL  ${name}`);
console.log(`${passed}/${total} live checks passed (all fixtures rolled back). Check names: tests/live/privacy-live.sql`);
process.exit(failed.length || passed !== total ? 1 : 0);
