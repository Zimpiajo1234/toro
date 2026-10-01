/**
 * The storage safety net (docs/STORAGE.md «Red de seguridad»): today's behaviour of the storage racks and the dock
 * trucks of the Benchmark and of the three-truck fixture, section by section, must be exactly the one frozen in
 * ./storageCharacterization.json (./storageCharacterization.ts says what each section holds). Phases 1–5 of the shared
 * storage model left it unchanged and phase 7 must too: when a phase renames an API, it ports storageCharacterization.ts,
 * never the JSON. Phase 6 (the rule changes) regenerated it on purpose, with the command in storageCharacterization.ts,
 * which runs the last test below instead of the comparisons; so did the conveyor belt's H1 (docs/CONVEYOR.md: the
 * Benchmark gained a belt, its coral ✚ box and one target), H1b (the belt a table at level 1: its ends' slots and
 * base level, the F press at its input), H1c (its closed base: the autopilot backs out of the input after the drop
 * and lowers the forks with V out there) and H2 (the belt's button beside its input: one more obstacle cell, the
 * routes round it; the presses counted, none in the Benchmark's plan).
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

  it('the Benchmark: 15 moves (exact), one complete assignment, 13 targets; the autopilot finishes it at 60 and 20 fps, F / V at the truck too, its belt delivering', () => {
    const benchmark = FROZEN.levels.benchmark;
    expect(benchmark.solver).toMatchObject({ lower: 15, upper: 15, exact: true, unsolvable: false });
    expect(benchmark.solver.plan).toHaveLength(15);
    expect(benchmark.targets.counts).toEqual({ zones: 3, slots: 6, truckLevels: 3, beltExits: 1, assignments: 1 });
    // Its truck's second column: «amarillo ✚» and a «libre» level on top (phase 6, docs/STORAGE.md rule 7).
    expect(benchmark.storage.slots.filter((s) => s.startsWith('t1:1:'))).toEqual(['t1:1:0 cell 2,-1 front 2,0 south · yellow/cross', 't1:1:1 cell 2,-1 front 2,0 south · libre']);
    // Its conveyor belt (docs/CONVEYOR.md): one floor cell, a table at level 1 (H1b), from its «libre» input e1 to its
    // end exit s1, both standing on it (their one slot at level 1), and its button beside the input (H2).
    expect(benchmark.storage.conveyors).toEqual(['c1 e1 (8,2) → 8,1 → s1 (8,0) · suelo@1 · botón 7,2']);
    expect(benchmark.storage.units.filter((u) => u.baseLevel !== undefined).map((u) => [u.id, u.baseLevel])).toEqual([
      ['e1', 1],
      ['s1', 1],
    ]);
    for (const run of [benchmark.autopilot60, benchmark.autopilot20]) {
      // The ride counts no move: the counter is the box moves driven; at the belt's input F once up to its slot and, once
      // backed out of it, V once down (H1c).
      expect(run).toMatchObject({ solved: true, moves: 15, counter: 15 });
      expect(run.forkStepsAt.truck).toBeGreaterThan(0);
      expect(run.forkStepsAt.beltIn).toBe(2);
      expect(run.log.filter((line) => line.endsWith('(cinta)'))).toEqual(['b9 e1:0:1 → s1:0:1 ok 8/13 (cinta)']);
      // Its shortest plan never needs the button (H2): the coral ✚ is the only box sent down the belt.
      expect(run.buttonPresses).toBe(0);
      expect(run.log.some((line) => line.endsWith('(botón)'))).toBe(false);
    }
  });
});

it.runIf(WRITE)('rewrites src/integration/storageCharacterization.json (TORO_CARACTERIZAR=1, with -u)', async () => {
  await expect(formatCharacterization(characterizationFile())).toMatchFileSnapshot('./storageCharacterization.json');
});
