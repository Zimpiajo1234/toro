import { Color, Mesh, type BufferGeometry, type MeshBasicMaterial } from 'three';
import type { CellPos } from '../../core/types';
import { damp } from '../../core/math';
import { ZONE } from '../dims';

const OPACITY = 0.85;

/**
 * Soft outline square on the floor where the carried box would land. Neutral tone on plain floor,
 * the zone's border tone when the drop would be on a matching zone. Glides between cells.
 */
export class DropPreview {
  readonly mesh: Mesh;
  private readonly neutral: Color;
  private readonly targetColor = new Color();
  private opacity = 0;

  constructor(
    geometry: BufferGeometry,
    private readonly material: MeshBasicMaterial,
    neutral: Color,
    private readonly size: { width: number; depth: number },
  ) {
    this.neutral = neutral.clone();
    this.material.color.copy(this.neutral);
    this.mesh = new Mesh(geometry, material);
    this.mesh.position.y = ZONE.padHeight + 0.008;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  /**
   * `match` = border color of a matching zone under the drop cell, or null. `topY` = height of the surface the
   * box would land on (0 = floor, else the top of the stack): the outline floats there as a ghost contour.
   */
  sync(cell: CellPos | null, match: Color | null, dt: number, topY = 0): void {
    const m = this.mesh;
    if (cell) {
      const x = cell.x + 0.5 - this.size.width / 2;
      const z = cell.z + 0.5 - this.size.depth / 2;
      const y = ZONE.padHeight + 0.008 + topY;
      if (this.opacity < 0.05) {
        m.position.set(x, y, z);
      } else {
        m.position.x = damp(m.position.x, x, 22, dt);
        m.position.z = damp(m.position.z, z, 22, dt);
        m.position.y = damp(m.position.y, y, 16, dt);
      }
    }
    this.opacity = damp(this.opacity, cell ? OPACITY : 0, cell ? 14 : 10, dt);
    this.targetColor.copy(match ?? this.neutral);
    this.material.color.lerp(this.targetColor, 1 - Math.exp(-14 * dt));
    this.material.opacity = this.opacity;
    m.visible = this.opacity > 0.01;
  }
}
