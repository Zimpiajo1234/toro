import { Group, Mesh, Vector3, type BufferGeometry, type MeshBasicMaterial } from 'three';
import { damp, easeInOutSine } from '../../core/math';
import type { FitBox } from '../CameraRig';

/** Below this height scale the wall is hidden: its squashed trim would otherwise z-fight the floor. */
const HIDE_SCALE = 0.02;
/**
 * Over the last part of the sink the wall also thins onto its inner face (the floor edge), so what is
 * left never lingers as a flat strip beside the slab that then pops away.
 */
const THIN_FROM = 0.2;
/** Shafts switch off near the bottom of the sink, where they already weigh visibility² ≈ 0. */
const SHAFT_MIN_VISIBILITY = 0.05;

/**
 * A back wall that gently sinks into the floor when the camera orbits behind it (so it never hides
 * the warehouse) and rises again when it is back in the background.
 */
export class WallView {
  readonly group = new Group();
  readonly fitBox: FitBox;
  private visibility = 1;
  private shafts: Mesh | null = null;
  private shaftMaterial: MeshBasicMaterial | null = null;

  constructor(
    private readonly inward: Vector3,
    fitMin: Vector3,
    fitMax: Vector3,
  ) {
    this.fitBox = { min: fitMin, max: fitMax, heightScale: 1 };
  }

  /**
   * Adds the window light shafts. They fade with the wall (their own material, so each wall fades
   * alone): squashed onto the floor by the sinking group they would otherwise z-fight the tiles.
   */
  addShafts(geometry: BufferGeometry, material: MeshBasicMaterial): void {
    const mesh = new Mesh(geometry, material);
    mesh.renderOrder = 3;
    this.shafts = mesh;
    this.shaftMaterial = material;
    this.group.add(mesh);
  }

  /** `immediate` skips the animation (level load). `shaftGain` scales the shaft opacity (warmth). */
  sync(cameraYaw: number, dt: number, immediate = false, shaftGain = 1): void {
    // The inner face looks at the camera when inward · cameraDir > 0 → wall is in the background.
    const facing = this.inward.x * Math.sin(cameraYaw) + this.inward.z * Math.cos(cameraYaw);
    const target = facing > -0.05 ? 1 : 0;
    this.visibility = immediate ? target : damp(this.visibility, target, 5, dt);
    const v = this.visibility;
    const s = v < 0.002 ? 0 : easeInOutSine(v);
    this.group.scale.y = Math.max(s, 1e-4);
    this.group.scale.z = Math.max(Math.min(1, s / THIN_FROM), 1e-4);
    this.group.visible = s > HIDE_SCALE;
    this.fitBox.heightScale = s;
    if (this.shafts && this.shaftMaterial) {
      this.shaftMaterial.opacity = shaftGain * v * v;
      this.shafts.visible = v > SHAFT_MIN_VISIBILITY;
    }
  }
}
