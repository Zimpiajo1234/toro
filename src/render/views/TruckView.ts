import { Box3, Group, Mesh, Vector3, type BufferGeometry, type Material, type MeshBasicMaterial, type MeshStandardMaterial } from 'three';
import type { WallSide } from '../../core/types';
import type { FitBox } from '../CameraRig';
import { DIORAMA, DOCK } from '../dims';
import { RackBay, SlotLight, type SlotTone } from './RackView';

/**
 * How the truck's reach beyond its wall stays in the camera fit as the wall sinks: 1 − (1 − s)^FIT_REACH_EASE of its
 * height scale s. 1 = in step with the wall (the gentlest, but mid-sink the far end of the still-deep, flattening
 * truck leaves the frame); higher keeps it framed longer and drops it later and faster (toward the old snap). With 3,
 * the Benchmark's worst per-frame zoom step is ≈ 1.1 % landscape / 1.4 % portrait (2.4 % / 3.1 % with the old snap).
 */
const FIT_REACH_EASE = 3;
const fitReach = (s: number): number => 1 - (1 - Math.min(1, Math.max(0, s))) ** FIT_REACH_EASE;

/**
 * One loading dock truck (docs/DOCKS.md, builders/truck). Inside the warehouse (`group`, world space): its bed (flat:
 * never in the way), the cue board of each bed column (a bay: its posts, bars and one glowing panel per level; it
 * fades like a rack bay when it hides the forklift, a box or a zone, which only happens with its wall sunk, the camera
 * outside) and, per level, the sticker (unlit, opaque: never fades, never dims) and a glow band around the level's box.
 * A level lights exactly like a rack slot (RackView SlotLight): only with its destined box on satisfied levels below
 * (`satisfied`), a flash as it lands, then a soft steady glow; it pulses clearly while a box that fits its cue is
 * carried and it is the next level of its column (`loadable`).
 * Outside (`outside`, its wall's local space): the rest of the truck, which sinks with its wall (follow): when the
 * camera orbits behind that wall the truck goes with it, and rises again with it.
 */
export class TruckView {
  readonly id: string;
  readonly group = new Group();
  readonly outside = new Group();
  readonly bays: RackBay[] = [];
  /** World bounds of the inside parts (bed and cue boards). */
  readonly bounds = new Box3();
  /** World bounds of the outside parts standing (shadows). */
  readonly outsideBounds = new Box3();
  /**
   * Keeps the outside parts in frame while they stand; follows them down to nothing (a point under the dock) while
   * they sink, so an orbit behind the wall frames the warehouse alone, as without a truck.
   */
  readonly fitBox: FitBox = { min: new Vector3(), max: new Vector3(), heightScale: 1 };
  private readonly lights = new Map<string, SlotLight>();
  /** Outside parts' bounds in their wall's local space, and that wall's transform (a quarter turn or none). */
  private readonly local = new Box3();
  private readonly origin = new Vector3();
  private readonly turned: boolean;

  constructor(
    id: string,
    wall: WallSide,
    /** Its wall's transform (builders/walls WallLayout position / rotationY). */
    wallPosition: Vector3,
    wallRotationY: number,
    bedGeometry: BufferGeometry,
    bedMaterial: Material,
    /** One cue board frame per bed column (builders/truck buildTruckBoardBays), world space. */
    boardGeometries: readonly BufferGeometry[],
    /** A fresh frame material per board (each fades on its own). */
    frameMaterial: () => MeshStandardMaterial,
    depthOnly: Material,
    /** The outside parts, in its wall's local space (builders/truck buildTruckOutside). */
    outsideGeometry: BufferGeometry,
    outsideMaterial: Material,
    /** Delay before a level lights (lets the dropped box land first). */
    private readonly landDelay: number,
  ) {
    this.id = id;
    this.group.userData.truckId = id;
    this.outside.userData.truckOutside = id;
    this.turned = wall === 'west';

    const bed = new Mesh(bedGeometry, bedMaterial);
    bed.receiveShadow = true;
    bed.userData.truckBed = id;
    this.group.add(bed);
    bedGeometry.computeBoundingBox();
    this.bounds.copy(bedGeometry.boundingBox!);
    // A box on the bed is never the board's own (it is loaded in front of it): empty `holds`, every box counts.
    const holds = new Box3();
    boardGeometries.forEach((geometry, column) => {
      const bay = new RackBay(this.group, holds, column, geometry, frameMaterial(), depthOnly, 'truck');
      this.bays.push(bay);
      this.bounds.union(bay.bounds);
    });

    // Outside: pivot on the driveway (the truck sinks onto it as its wall sinks into the floor), in the wall's frame.
    const mesh = new Mesh(outsideGeometry, outsideMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.y = -DOCK.apronTop;
    this.outside.add(mesh);
    this.outside.position.set(wallPosition.x, wallPosition.y + DOCK.apronTop, wallPosition.z);
    this.outside.rotation.y = wallRotationY;
    this.origin.copy(wallPosition);
    outsideGeometry.computeBoundingBox();
    this.local.copy(outsideGeometry.boundingBox!);
    this.follow(1, 1, true);
    this.outsideBounds.set(this.fitBox.min.clone(), this.fitBox.max.clone());
  }

  /**
   * A truck level: its panel on the board (`panel`, `panelMaterial`: lit, glows, fades with the board), its sticker
   * (`cueGeometry`, `cueMaterial`: unlit, opaque; glows with the panel, never fades), both at (x, cueY, z), and its
   * glow band (`bandGeometry`, `bandMaterial`: hidden until it glows) at the level's floor (x, bandY, z); `yaw` turns
   * their local +z toward the loading side; `destined` = its tones with its destined box.
   */
  addLevel(
    id: string,
    column: number,
    satisfied: boolean,
    x: number,
    z: number,
    yaw: number,
    cueY: number,
    bandY: number,
    panel: BufferGeometry,
    panelMaterial: MeshStandardMaterial,
    cueGeometry: BufferGeometry,
    cueMaterial: MeshBasicMaterial,
    bandGeometry: BufferGeometry,
    bandMaterial: MeshBasicMaterial,
    destined: SlotTone | null,
  ): void {
    const bay = this.bays[column];
    if (!bay) return;
    const mesh = bay.addPart(panel, panelMaterial);
    const cue = new Mesh(cueGeometry, cueMaterial);
    const band = new Mesh(bandGeometry, bandMaterial);
    band.renderOrder = 1;
    band.visible = false;
    mesh.position.set(x, cueY, z);
    cue.position.set(x, cueY, z);
    band.position.set(x, bandY, z);
    for (const m of [mesh, cue, band]) m.rotation.y = yaw;
    mesh.userData.truckSlotId = id;
    cue.userData.truckCue = id;
    band.userData.truckGlow = id;
    this.group.add(cue, band);
    this.lights.set(id, new SlotLight({ satisfied }, panelMaterial, cueMaterial, band, bandMaterial, destined, this.landDelay));
  }

  /** `invite` 0‥1: how strongly the level pulses for the carried box; `carried` = that box's tones (null: none). */
  syncLevel(id: string, satisfied: boolean, invite: number, carried: SlotTone | null, time: number, dt: number): void {
    this.lights.get(id)?.sync(satisfied, invite, carried, time, dt);
  }

  /** Level complete: a level's panel and sticker pulse once, after `delay`. */
  playWave(id: string, delay: number): void {
    this.lights.get(id)?.playWave(delay);
  }

  /**
   * Follow its wall's sink (WallView: height scale `sy`, thickness scale `sz` toward its inner face, `visible`), so the
   * truck outside goes down with the wall onto its driveway and never stands in front of the warehouse. Allocation-free.
   * The fit box's reach beyond the wall follows the height scale (`fitReach`: the wall's eased sink, over its whole
   * length), never `sz`: that one only moves over the last 20 % of the sink, so it put the truck's whole depth back in
   * the frame within ~4 frames (a 2.4 %/frame zoom on the idle orbit). The frame now widens and narrows as gently as
   * the wall rises and sinks, and a flattening truck stays inside it (views/TruckView.test.ts, on the Benchmark).
   */
  follow(sy: number, sz: number, visible: boolean): void {
    this.outside.scale.set(1, sy, sz);
    this.outside.visible = visible;
    const L = this.local;
    const pivot = DOCK.apronTop;
    const slab = -DIORAMA.slabThickness;
    // Heights: toward a point at the slab's underside as it sinks (always inside the warehouse's own framing).
    const y0 = slab + (L.min.y - slab) * sy;
    const y1 = Math.max(y0, pivot + (L.max.y - pivot) * sy);
    const reach = fitReach(sy);
    const z0 = L.min.z * reach;
    const z1 = L.max.z * reach;
    const o = this.origin;
    const min = this.fitBox.min;
    const max = this.fitBox.max;
    if (this.turned) {
      // A quarter turn: local (x, z) → world (z, −x).
      min.set(o.x + z0, y0, o.z - L.max.x);
      max.set(o.x + z1, y1, o.z - L.min.x);
    } else {
      min.set(o.x + L.min.x, y0, o.z + z0);
      max.set(o.x + L.max.x, y1, o.z + z1);
    }
  }
}
