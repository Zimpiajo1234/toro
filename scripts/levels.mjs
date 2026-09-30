/**
 * Level tooling (docs/LEVELS.md):
 *   npm run levels                   every level (the game's, then the special ones in especiales/): map, legend and
 *                                    metrics, then a summary table
 *   npm run levels -- 3 benchmark    those levels in detail (order number, #position, id or file name)
 *   npm run levels -- 3 --estados 2000000   raise the work budget of the exact move search (default 150 000)
 *   npm run levels -- 3 --callejones 2000   explore more states in the dead-end check (default 60 per level)
 *   npm run levels:fmt               rewrite every src/data/levels/*.level and especiales/*.level in canonical form
 *   npm run levels:fmt -- --check    only report the files that are not canonical (exit code 1)
 *   npm run levels -- --minimos      recompute src/data/levelMinimums.json: every level's fewest box moves, read by the
 *                                    game's move counter (src/data/levels/minimums.ts); with --estados N, a bigger
 *                                    budget (kept in the file); with --check, only report whether it is stale (exit 1)
 *
 * The TypeScript sources are loaded through Vite's SSR module loader (TS, extensionless imports, import.meta.glob and
 * ?raw work exactly as in the game). No port, no HMR, no file watcher and its own cache dir, so it never disturbs a
 * running dev server. No dependencies beyond the project's.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const fmt = argv.includes('--fmt');
const check = argv.includes('--check');
const minimums = argv.includes('--minimos');
let maxWork;
let deadEndStates;
const names = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--fmt' || arg === '--check' || arg === '--minimos') continue;
  if (arg === '--estados') {
    maxWork = Number(argv[++i]);
    if (!Number.isInteger(maxWork) || maxWork < 1) fail('--estados necesita un número entero, p. ej. --estados 2000000');
    continue;
  }
  if (arg === '--callejones') {
    deadEndStates = Number(argv[++i]);
    if (!Number.isInteger(deadEndStates) || deadEndStates < 1) fail('--callejones necesita un número entero, p. ej. --callejones 2000');
    continue;
  }
  if (arg.startsWith('--')) fail(`opción desconocida ${arg} (usa --estados N, --callejones N, --minimos, o --check con levels:fmt)`);
  names.push(arg);
}
if (minimums && fmt) fail('--minimos y --fmt van por separado');
if (minimums && names.length > 0) fail('--minimos recalcula todos los niveles: no nombres ninguno');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const server = await createServer({
  root,
  configFile: false,
  logLevel: 'silent', // errors reach the catch below (authoring mistakes as «file:line:column: motivo»)
  appType: 'custom',
  cacheDir: path.join(root, 'node_modules', '.vite-levels'),
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  if (fmt) {
    const { formatLevel } = await server.ssrLoadModule('/src/data/asciiLevel.ts');
    // The game's levels and the special ones (especiales/: the registry keeps them out of LEVELS).
    const files = [];
    for (const folder of ['src/data/levels', 'src/data/levels/especiales']) {
      const names = await readdir(path.join(root, folder)).catch(() => []);
      for (const name of names.filter((n) => n.endsWith('.level')).sort()) files.push(`${folder}/${name}`);
    }
    const changed = [];
    for (const name of files) {
      const file = path.join(root, name);
      const text = await readFile(file, 'utf8');
      const canonical = formatLevel(text, name);
      if (canonical === text) continue;
      changed.push(name);
      if (!check) await writeFile(file, canonical, 'utf8');
    }
    if (check) {
      process.stdout.write(
        changed.length === 0
          ? `${files.length} archivos .level en forma canónica\n`
          : `No canónicos (npm run levels:fmt los reescribe):\n${changed.map((f) => `  ${f}\n`).join('')}`,
      );
      if (changed.length > 0) process.exitCode = 1;
    } else {
      process.stdout.write(
        changed.length === 0
          ? `${files.length} archivos .level: ya estaban en forma canónica\n`
          : `Reescritos en forma canónica:\n${changed.map((f) => `  ${f}\n`).join('')}`,
      );
    }
  } else if (minimums) {
    const { LEVEL_SOURCES, SPECIAL_LEVEL_SOURCES } = await server.ssrLoadModule('/src/data/levels/index.ts');
    const { DEFAULT_MINIMUM_WORK, MINIMUMS_PATH, computeMinimums, formatMinimums, minimumsChanges } = await server.ssrLoadModule(
      '/src/data/levels/minimumsBuild.ts',
    );
    const file = path.join(root, MINIMUMS_PATH);
    const current = await readFile(file, 'utf8').catch(() => null);
    let stored = null;
    try {
      stored = current === null ? null : JSON.parse(current);
    } catch {
      stored = null; // unreadable: rewritten from scratch
    }
    // The budget sticks: the one given now, else the file's, else the solver's default.
    const budget = maxWork ?? (Number.isInteger(stored?.maxWork) ? stored.maxWork : DEFAULT_MINIMUM_WORK);
    const levels = [...LEVEL_SOURCES, ...SPECIAL_LEVEL_SOURCES].map((s) => s.level);
    const fresh = computeMinimums(levels, budget);
    // Keep the file's line endings (the checkout may have turned them into CRLF).
    const eol = current !== null && current.includes('\r\n') ? '\r\n' : '\n';
    const text = formatMinimums(fresh).replace(/\n/g, eol);
    const same = current !== null && current === text;
    const changes = minimumsChanges(stored, fresh);
    const lines = (items) => items.map((item) => `  ${item}\n`).join('');
    const rows = Object.entries(fresh.levels).map(([id, m]) => `${id}: ${m.exact ? `${m.moves} (exacto)` : `≥ ${m.moves} (cota inferior: sube --estados)`}`);
    if (check) {
      process.stdout.write(
        same
          ? `${MINIMUMS_PATH} al día (${rows.length} niveles, presupuesto ${budget})\n`
          : `${MINIMUMS_PATH} desfasado (npm run levels -- --minimos lo reescribe):\n${lines(changes.length > 0 ? changes : ['formato'])}`,
      );
      if (!same) process.exitCode = 1;
    } else {
      if (!same) await writeFile(file, text, 'utf8');
      process.stdout.write(
        `${same ? 'Sin cambios' : 'Reescrito'}: ${MINIMUMS_PATH} (presupuesto ${budget})\n${lines(rows)}` +
          (changes.length > 0 ? `Cambios:\n${lines(changes)}` : ''),
      );
    }
  } else {
    const { LEVEL_SOURCES, SPECIAL_LEVEL_SOURCES } = await server.ssrLoadModule('/src/data/levels/index.ts');
    const { levelsReport } = await server.ssrLoadModule('/src/data/levels/report.ts');
    process.stdout.write(
      levelsReport([...LEVEL_SOURCES, ...SPECIAL_LEVEL_SOURCES], names, {
        timings: true,
        ...(maxWork === undefined ? {} : { maxWork }),
        ...(deadEndStates === undefined ? {} : { deadEndStates }),
      }),
    );
  }
} catch (error) {
  // Authoring mistakes arrive as "file:line:column: motivo"; no stack trace needed.
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await server.close();
}
