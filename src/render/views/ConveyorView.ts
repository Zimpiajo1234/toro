import { BufferAttribute, BufferGeometry, Mesh, Sphere, Vector3, type Material } from 'three';
import type { Placement } from '../paint';
import { BELT } from '../builders/conveyor';

/**
 * The faint stripes across a conveyor belt's surface (docs/CONVEYOR.md): thin bands, a touch lighter than the band,
 * that slide along it with its surface, only while it runs (so the box and the stripes move as one), clipped at both
 * ends of the band. One small geometry per belt whose vertices move in place: `sync(travel)` places them for the
 * distance the surface has moved (ConveyorState.travel, which never goes back); nothing is allocated per frame.
 */
export class BeltStripes {
  readonly mesh: Mesh;
  private readonly geometry = new BufferGeometry();
  private readonly positions: Float32Array;
  private readonly count: number;
  private readonly cos: number;
  private readonly sin: number;
  private travel = Number.NaN;

  constructor(
    material: Material,
    /** Belt-local → world (builders/conveyor beltPlacement): its input's centre, the yaw along it, its cells. */
    private readonly placement: Placement & { cells: number },
  ) {
    const length = placement.cells;
    this.count = Math.ceil(length / BELT.stripe.period) + 1;
    this.positions = new Float32Array(this.count * 18);
    const normals = new Float32Array(this.count * 18);
    for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('normal', new BufferAttribute(normals, 3));
    const ry = placement.ry ?? 0;
    this.cos = Math.cos(ry);
    this.sin = Math.sin(ry);
    // The stripes always stay on the band: a fixed bound around it, never recomputed.
    const mid = 0.5 + length / 2;
    const centre = new Vector3((placement.x ?? 0) + this.sin * mid, BELT.top, (placement.z ?? 0) + this.cos * mid);
    this.geometry.boundingSphere = new Sphere(centre, length / 2 + 1);
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.receiveShadow = true;
    this.mesh.userData.beltStripes = true;
    this.sync(0);
  }

  /** Where the stripes stand once the surface has moved `travel` cells (they only move when it changes). */
  sync(travel: number): void {
    if (travel === this.travel) return;
    this.travel = travel;
    const { period, width, lift } = BELT.stripe;
    const z0 = 0.5;
    const z1 = this.placement.cells + 0.5;
    const offset = ((travel % period) + period) % period;
    const half = BELT.halfW;
    const y = BELT.top + lift;
    for (let k = 0; k < this.count; k++) {
      const start = z0 + offset + (k - 1) * period;
      const a = Math.min(z1, Math.max(z0, start));
      const b = Math.min(z1, Math.max(z0, start + width));
      // Two triangles facing up (counter-clockwise seen from above), turned onto the belt.
      const o = k * 18;
      this.put(o, -half, y, a);
      this.put(o + 3, -half, y, b);
      this.put(o + 6, half, y, b);
      this.put(o + 9, -half, y, a);
      this.put(o + 12, half, y, b);
      this.put(o + 15, half, y, a);
    }
    (this.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }

  /** Writes belt-local (x, y, z) at `o`, in world space. */
  private put(o: number, x: number, y: number, z: number): void {
    const p = this.positions;
    p[o] = (this.placement.x ?? 0) + this.cos * x + this.sin * z;
    p[o + 1] = y;
    p[o + 2] = (this.placement.z ?? 0) - this.sin * x + this.cos * z;
  }
}
