import { Box3, LessEqualDepth, Mesh, type BufferGeometry, type Material, type MeshStandardMaterial, type Vector3 } from 'three';
import { damp } from '../../core/math';

/** Opacity of a shelf while it stands in front of the forklift, a box or a zone. */
const GHOST_OPACITY = 0.35;
/** Fade speed toward the ghost and back (1/s, exponential). */
const FADE_RATE = 6;
/**
 * Transparent-pass slots. Solid: first (before the floor overlays and light shafts, exactly like an
 * opaque mesh). Ghosted: after the overlays (≤ 3), so drop previews and halos behind it still show.
 */
const SOLID_ORDER = -1;
const GHOST_ORDER = 10;

/**
 * One shelf, as its own mesh so it can fade out of the way when it hides something the player needs
 * to see (brief: "visión clara del almacén siempre"). The ghost is drawn in two passes so it stays a
 * clean silhouette instead of posts, boards and kraft boxes blending through each other: a depth-only
 * prepass writes the shelf's nearest surface, then the color pass blends only that surface.
 *
 * The color material is transparent even while solid (opacity 1, depth write on): toggling
 * `transparent` would switch shader programs mid-game.
 */
export class ShelfView {
  readonly mesh: Mesh;
  /** World bounds of the shelf and its stored boxes. */
  readonly bounds = new Box3();
  private readonly depthPass: Mesh;
  private opacity = 1;

  constructor(
    geometry: BufferGeometry,
    private readonly material: MeshStandardMaterial,
    depthOnly: Material,
  ) {
    material.transparent = true;
    material.depthFunc = LessEqualDepth;
    this.mesh = new Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData.shelf = true;
    this.depthPass = new Mesh(geometry, depthOnly);
    this.depthPass.visible = false;
    this.mesh.add(this.depthPass);
    geometry.computeBoundingBox();
    this.bounds.copy(geometry.boundingBox!);
    this.apply(0);
  }

  /**
   * `hiding`: the shelf covers an actor. `rank` orders ghosted shelves back to front (0 = farthest),
   * so two ghosts overlapping on screen still blend correctly.
   */
  sync(hiding: boolean, rank: number, dt: number): void {
    this.opacity = damp(this.opacity, hiding ? GHOST_OPACITY : 1, FADE_RATE, dt);
    if (!hiding && this.opacity > 0.995) this.opacity = 1;
    this.apply(rank);
  }

  private apply(rank: number): void {
    const ghost = this.opacity < 1;
    this.material.opacity = this.opacity;
    this.material.depthWrite = !ghost;
    this.depthPass.visible = ghost;
    this.depthPass.renderOrder = GHOST_ORDER + rank * 2;
    this.mesh.renderOrder = ghost ? GHOST_ORDER + rank * 2 + 1 : SOLID_ORDER;
  }
}

/**
 * True when box `shelf` hides part of the box [aMin, aMax] from an orthographic camera looking along
 * -`back`: some ray from the actor toward the camera enters the shelf. Exact for boxes: that happens
 * iff the ray t·back (t > 0) meets the Minkowski difference [shelf.min − aMax, shelf.max − aMin].
 */
export function hidesBehind(shelf: Box3, aMin: Vector3, aMax: Vector3, back: Vector3): boolean {
  let near = 0;
  let far = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const lo = shelf.min.getComponent(axis) - aMax.getComponent(axis);
    const hi = shelf.max.getComponent(axis) - aMin.getComponent(axis);
    const d = back.getComponent(axis);
    if (Math.abs(d) < 1e-9) {
      if (lo > 0 || hi < 0) return false;
      continue;
    }
    const t0 = lo / d;
    const t1 = hi / d;
    near = Math.max(near, Math.min(t0, t1));
    far = Math.min(far, Math.max(t0, t1));
    if (near > far) return false;
  }
  return far > 0;
}
