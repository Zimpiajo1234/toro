/**
 * The storage safety net (docs/STORAGE.md «Red de seguridad»): today's behaviour of the storage racks and the dock
 * trucks of the Benchmark and of the three-truck fixture, section by section, must be exactly the one frozen in
 * ./storageCharacterization.json (./storageCharacterization.ts says what each section holds). Phases 1–5 of the shared
 * storage model left it unchanged and phase 7 must too: when a phase renames an API, it ports storageCharacterization.ts,
 * never the JSON. Phase 6 (the rule changes) regenerated it on purpose, with the command in storageCharacterization.ts,
 * which runs the last test below instead of the comparisons.
 */
import { describe, expect, it } from 'vitest';
import stored from './storageCharacterization.json';
import fileText from './storageCharacterization.json?raw';
import {
  CHARACTERIZATION_PATH,
  CHARACTERIZATION_SECTIONS,
  CHARACTERIZED_LEVELS,
  characterizationFile,
  characterizeSection,
  formatCharacterization,
  type CharacterizationFile,
} from './storageCharacterization';

/** Regeneration run (a deliberate rule change only): `TORO_CARACTERIZAR=1 npx vitest run src/integration/storageCharacterization.test.ts -u`. */
const WRITE = import.meta.env.TORO_CARACTERIZAR === '1';
const FROZEN = stored as unknown as CharacterizationFile;
const CHANGED = `the storage behaviour changed: phase 7 of docs/STORAGE.md must leave ${CHARACTERIZATION_PATH} as it is (port storageCharacterization.ts to a renamed API, never the JSON); only a deliberate rule change regenerates it, as phase 6 did`;
/** As the file stores it (JSON has no undefined, no -0). */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe.skipIf(WRITE)('storage characterization (src/integration/storageCharacterization.json)', () => {
  it('covers the Benchmark and the three-truck fixture, every section, in the form the helper writes', () => {
    expect(Object.keys(FROZEN.levels)).toEqual(CHARACTERIZED_LEVELS.map((level) => level.id));
    for (const entry of Object.values(FROZEN.levels)) expect(Object.keys(entry)).toEqual([...CHARACTERIZATION_SECTIONS]);
    expect(fileText.replace(/\r\n/g, '\n')).toBe(formatCharacterization(FROZEN));
  });

  for (const level of CHARACTERIZED_LEVELS) {
    describe(level.id, () => {
      it.each([...CHARACTERIZATION_SECTIONS])('%s is unchanged', (section) => {
        expect(plain(characterizeSection(level, section)), CHANGED).toStrictEqual(FROZEN.levels[level.id]?.[section]);
      });
    });
  }

  it('the Benchmark: 14 moves (exact), one complete assignment, 12 targets; the autopilot finishes it at 60 and 20 fps, F / V at the truck too', () => {
    const benchmark = FROZEN.levels.benchmark;
    expect(benchmark.solver).toMatchObject({ lower: 14, upper: 14, exact: true, unsolvable: false });
    expect(benchmark.solver.plan).toHaveLength(14);
    expect(benchmark.targets.counts).toEqual({ zones: 3, slots: 6, truckLevels: 3, assignments: 1 });
    // Its truck's second column: «amarillo ✚» and a «libre» level on top (phase 6, docs/STORAGE.md rule 7).
    expect(benchmark.storage.slots.filter((s) => s.startsWith('t1:1:'))).toEqual(['t1:1:0 cell 2,-1 front 2,0 south · yellow/cross', 't1:1:1 cell 2,-1 front 2,0 south · libre']);
    for (const run of [benchmark.autopilot60, benchmark.autopilot20]) {
      expect(run).toMatchObject({ solved: true, moves: 14, counter: 14 });
      expect(run.forkStepsAt.truck).toBeGreaterThan(0);
    }
  });
});

it.runIf(WRITE)('rewrites src/integration/storageCharacterization.json (TORO_CARACTERIZAR=1, with -u)', async () => {
  await expect(formatCharacterization(characterizationFile())).toMatchFileSnapshot('./storageCharacterization.json');
});
