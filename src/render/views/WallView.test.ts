import { BufferGeometry, MeshBasicMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { WallView } from './WallView';

/** North wall: inward +z, so it sinks when the camera goes behind it (yaw 180°). */
function northWall(): { wall: WallView; shafts: MeshBasicMaterial } {
  const wall = new WallView(new Vector3(0, 0, 1), new Vector3(0, 0, -0.2), new Vector3(8, 2.2, 0));
  const shafts = new MeshBasicMaterial({ transparent: true });
  wall.addShafts(new BufferGeometry(), shafts);
  wall.sync(Math.PI / 4, 0, true);
  return { wall, shafts };
}

describe('WallView', () => {
  it('fades its light shafts with the sink, so nothing squashed ever lies on the floor at full strength', () => {
    const { wall, shafts } = northWall();
    const mesh = wall.group.children[0];
    expect(shafts.opacity).toBe(1);
    for (let i = 0; i < 180; i++) {
      wall.sync(Math.PI, 1 / 60, false, 1.2);
      const s = wall.group.scale.y;
      // The squashed floor patch would sit under the tiles below ~30 % height: by then it is faint.
      if (s < 0.3) expect(shafts.opacity).toBeLessThan(0.2);
      // Shafts go before the wall hides; the wall hides before its trim reaches the floor plane.
      if (!mesh.visible) expect(s).toBeLessThan(0.05);
      if (s <= 0.02) expect(wall.group.visible).toBe(false);
      if (wall.group.visible) expect(wall.group.scale.z).toBeGreaterThan(0.09);
    }
    expect(wall.group.visible).toBe(false);
    expect(mesh.visible).toBe(false);
    expect(wall.fitBox.heightScale).toBeLessThan(0.001);
  });

  it('rises back with its shafts at the warmth-scaled strength', () => {
    const { wall, shafts } = northWall();
    for (let i = 0; i < 180; i++) wall.sync(Math.PI, 1 / 60);
    for (let i = 0; i < 240; i++) wall.sync(Math.PI / 4, 1 / 60, false, 1.2);
    expect(wall.group.visible).toBe(true);
    expect(wall.group.scale.y).toBeCloseTo(1, 3);
    expect(wall.group.scale.z).toBe(1);
    expect(shafts.opacity).toBeCloseTo(1.2, 3);
  });
});
