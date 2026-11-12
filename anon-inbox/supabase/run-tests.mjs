// Runs the pgTAP tests in supabase/tests against the linked Supabase project, without Docker.
// Everything runs in one transaction that is rolled back, so test users never persist.
//   node supabase/run-tests.mjs
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cli = process.env.SUPABASE_CLI || join(process.env.HOME, '.local/supabase/node_modules/.bin/supabase');
let failed = 0;

for (const file of readdirSync(join(here, 'tests')).filter((f) => f.endsWith('.sql')).sort()) {
  // Capture each assertion's TAP line in a temp table, then print them before rolling back.
  const sql = readFileSync(join(here, 'tests', file), 'utf8')
    .replace(/select plan\((\d+)\);/, 'select plan($1);\ncreate temp table tap_out (n bigint generated always as identity, line text);\ngrant all on tap_out to public;')
    .replace(/^select (throws_ok|lives_ok|is|isnt|matches|ok)\(/gm, 'insert into tap_out (line) select $1(')
    .replace('select * from finish();', "select set_config('role', 'postgres', true);\nselect n, line from tap_out order by n;");
  const tmp = join(mkdtempSync(join(tmpdir(), 'tap-')), file);
  writeFileSync(tmp, sql);

  const out = execFileSync(cli, ['db', 'query', '--remote', '--yes', '-f', tmp, '--output-format', 'json'],
    { cwd: dirname(here), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const rows = JSON.parse(out.slice(out.indexOf('{\n'))).rows || [];
  console.log(`\n${file}`);
  for (const { line } of rows) console.log('  ' + line);
  const bad = rows.filter((r) => !r.line.startsWith('ok')).length;
  failed += bad;
  console.log(`  ${rows.length - bad}/${rows.length} passed`);
}
process.exit(failed ? 1 : 0);
