import { Color, Mesh, type BufferGeometry, type MeshBasicMaterial } from 'three';
import { damp } from '../../core/math';
import type { MarkerPlace } from '../storage/types';

/** Working at a storage column (the forks go by the keys at every unit): the level F / V selected, faintly. */
const SELECTED_OPACITY = 0.3;
/** The action works on that level now (a box to pick, or room for the load). */
const READY_OPACITY = 0.8;

/**
 * Soft frame around the level the forks are set to while the forklift works at a storage column (hint.storage: a
 * rack's shelf, framed on the front face and around the back panel, builders/rack; a truck level, its cell of the sign
 * over the dock door, builders/truck), so the player sees what F / V (or the wheel) selected, even before the action
 * would work. One per skin, shared by its units: where it goes on a unit is that unit's (render/storage
 * StorageUnitView.markerAt). Glides between levels with the forks; neutral tone, or the carried box's zone tone when the
 * drop there would take it (its cue fits the box; in a stack, also its next level on right levels).
 */
export class SlotMarker {
  readonly mesh: Mesh;
  private readonly neutral: Color;
  private readonly targetColor = new Color();
  private opacity = 0;

  constructor(
    geometry: BufferGeometry,
    private readonly material: MeshBasicMaterial,
    neutral: Color,
  ) {
    this.neutral = neutral.clone();
    this.material.color.copy(this.neutral);
    this.mesh = new Mesh(geometry, material);
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    this.mesh.userData.slotMarker = true;
  }

  /** `place` = where the selected level is framed (null: not at one); `match` = tint for a carried box its cue fits. */
  sync(place: MarkerPlace | null, ready: boolean, match: Color | null, dt: number): void {
    const m = this.mesh;
    if (place) {
      if (this.opacity < 0.05 || m.rotation.y !== place.yaw) {
        m.position.set(place.x, place.y, place.z);
        m.rotation.y = place.yaw;
      } else {
        m.position.x = damp(m.position.x, place.x, 22, dt);
        m.position.z = damp(m.position.z, place.z, 22, dt);
        m.position.y = damp(m.position.y, place.y, 14, dt);
      }
    }
    const target = place ? (ready ? READY_OPACITY : SELECTED_OPACITY) : 0;
    this.opacity = damp(this.opacity, target, place ? 12 : 10, dt);
    this.targetColor.copy(match ?? this.neutral);
    this.material.color.lerp(this.targetColor, 1 - Math.exp(-14 * dt));
    this.material.opacity = this.opacity;
    m.visible = this.opacity > 0.01;
  }
}
