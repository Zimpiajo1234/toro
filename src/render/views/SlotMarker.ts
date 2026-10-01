import { Color, Mesh, type BufferGeometry, type MeshBasicMaterial } from 'three';
import { damp } from '../../core/math';
import type { SlotState } from '../../core/types';
import { outwardYaw } from '../builders/rack';
import { rackSlotY } from '../dims';

/** Facing a rack column: the slot F / V selected, faintly. */
const SELECTED_OPACITY = 0.3;
/** The action works on that slot now (a box to pick, or room for the load). */
const READY_OPACITY = 0.8;

/**
 * Soft frame around the slot the forks are set to while the forklift faces a rack column (hint.rack), on the front
 * face and around the back panel, so the player sees what F / V (or the wheel) selected, even before the action would
 * work. Glides between levels with the forks; neutral tone, or the carried box's zone tone when its cue fits the box.
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

  /** `slot` = the selected slot (null when not at a rack); `match` = tint for a carried box its cue fits, or null. */
  sync(slot: SlotState | null, ready: boolean, match: Color | null, dt: number): void {
    const m = this.mesh;
    if (slot) {
      const yaw = outwardYaw(slot.facing);
      const y = rackSlotY(slot.level);
      if (this.opacity < 0.05 || m.rotation.y !== yaw) {
        m.position.set(slot.pos.x, y, slot.pos.z);
        m.rotation.y = yaw;
      } else {
        m.position.x = damp(m.position.x, slot.pos.x, 22, dt);
        m.position.z = damp(m.position.z, slot.pos.z, 22, dt);
        m.position.y = damp(m.position.y, y, 14, dt);
      }
    }
    const target = slot ? (ready ? READY_OPACITY : SELECTED_OPACITY) : 0;
    this.opacity = damp(this.opacity, target, slot ? 12 : 10, dt);
    this.targetColor.copy(match ?? this.neutral);
    this.material.color.lerp(this.targetColor, 1 - Math.exp(-14 * dt));
    this.material.opacity = this.opacity;
    m.visible = this.opacity > 0.01;
  }
}
