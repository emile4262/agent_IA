// Lance les tests de bout en bout l'un après l'autre (ils utilisent le même port) sur le code compilé (dist/).
// Chacun démarre l'API sur une base MongoDB temporaire : la vraie base et le .env ne sont jamais utilisés.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const only = process.argv.slice(2);
const files = fs
  .readdirSync(__dirname)
  .filter((file) => file.endsWith('.e2e.cjs'))
  .filter((file) => only.length === 0 || only.some((name) => file.startsWith(`${name}.`)))
  .sort();

if (files.length === 0) {
  console.error(`Aucun test trouvé pour : ${only.join(', ')}`);
  process.exit(1);
}

const results = files.map((file) => {
  console.log(`\n=== ${file} ===`);
  const started = Date.now();
  const { status } = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  return { file, ok: status === 0, seconds: Math.round((Date.now() - started) / 1000) };
});

console.log('\n=== Bilan ===');
for (const { file, ok, seconds } of results) {
  console.log(`${ok ? 'OK ' : 'KO '} ${file} (${seconds} s)`);
}
process.exit(results.every(({ ok }) => ok) ? 0 : 1);
