import { ConeGeometry, CylinderGeometry, IcosahedronGeometry } from 'three';
import type { LevelData, LevelPlant } from '../../core/types';
import type { Theme } from '../../themes/types';
import type { PartList } from '../paint';
import { range, type Rng } from '../random';

const POT_H = 0.3;
const VARIANTS = 3;

/**
 * Potted plant: soft low-segment pot (smooth parts) + a few flat-shaded sage leaf clumps (faceted parts).
 * Variants: 0 round bush, 1 little cypress, 2 upright leaves.
 */
export function addPlant(pots: PartList, leaves: PartList, plant: LevelPlant, level: LevelData, theme: Theme, rng: Rng): void {
  const x = plant.x + 0.5 - level.size.width / 2;
  const z = plant.z + 0.5 - level.size.depth / 2;
  const spin = rng() * Math.PI * 2;

  pots.add(new CylinderGeometry(0.19, 0.15, POT_H, 9), theme.plant.pot, { x, y: POT_H / 2, z, ry: spin });
  pots.add(new CylinderGeometry(0.205, 0.2, 0.05, 9), theme.plant.pot, { x, y: POT_H - 0.01, z, ry: spin });
  pots.add(new CylinderGeometry(0.175, 0.175, 0.02, 9), theme.plant.soil, { x, y: POT_H + 0.012, z, ry: spin });

  const palette = theme.plant.leaves;
  const leaf = (i: number) => palette[i % palette.length];
  const variant = (((plant.variant ?? 0) % VARIANTS) + VARIANTS) % VARIANTS;
  const baseY = POT_H + 0.02;

  if (variant === 0) {
    const clumps: ReadonlyArray<readonly [number, number, number, number]> = [
      [0, 0.26, 0, 0.25],
      [0.13, 0.17, 0.06, 0.18],
      [-0.1, 0.2, -0.09, 0.17],
      [-0.03, 0.42, 0.04, 0.15],
    ];
    clumps.forEach(([cx, cy, cz, r], i) => {
      const c = rotate(cx, cz, spin);
      leaves.add(new IcosahedronGeometry(r, 0), leaf(i), {
        x: x + c.x,
        y: baseY + cy,
        z: z + c.z,
        rx: range(rng, 0, Math.PI),
        ry: range(rng, 0, Math.PI),
        sy: 0.88,
      });
    });
  } else if (variant === 1) {
    leaves.add(new ConeGeometry(0.22, 0.52, 7), leaf(1), { x, y: baseY + 0.3, z, ry: spin });
    leaves.add(new ConeGeometry(0.17, 0.42, 7), leaf(0), { x, y: baseY + 0.6, z, ry: spin + 0.4 });
    leaves.add(new ConeGeometry(0.11, 0.3, 6), leaf(2), { x, y: baseY + 0.86, z, ry: spin + 0.8 });
  } else {
    const blades = 6;
    for (let i = 0; i < blades; i++) {
      const a = spin + (i / blades) * Math.PI * 2 + range(rng, -0.2, 0.2);
      const tilt = range(rng, 0.18, 0.42);
      const h = range(rng, 0.46, 0.66);
      const dirX = Math.sin(a);
      const dirZ = Math.cos(a);
      // Scale flattens the blade, tilt leans it outward, yaw points it radially.
      leaves.add(new ConeGeometry(0.07, h, 4), leaf(i), {
        x: x + dirX * (0.05 + Math.sin(tilt) * h * 0.5),
        y: baseY + Math.cos(tilt) * h * 0.5 - 0.02,
        z: z + dirZ * (0.05 + Math.sin(tilt) * h * 0.5),
        rx: tilt,
        ry: a,
        order: 'YXZ',
        sz: 0.45,
      });
    }
  }
}

function rotate(x: number, z: number, a: number): { x: number; z: number } {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: x * c + z * s, z: -x * s + z * c };
}
