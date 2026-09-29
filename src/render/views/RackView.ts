import {
  Box3,
  Group,
  LessEqualDepth,
  Mesh,
  type BufferGeometry,
  type Material,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
} from 'three';
import { damp, easeInOutSine, easeOutCubic, lerp } from '../../core/math';
import type { SlotState } from '../../core/types';
import { outwardYaw } from '../builders/rack';
import { rackSlotY } from '../dims';
import { OneShot, bump } from '../tween';

/** Opacity of a rack bay while it stands in front of the forklift or its load (as the wooden shelves). */
const GHOST_OPACITY = 0.35;
/** …and while it only hides resting boxes or zones: a light fade that shows them and keeps the rack calm. */
const SOFT_GHOST_OPACITY = 0.6;
/** Fade speed toward the ghost and back (1/s, exponential). */
const FADE_RATE = 6;
/** Transparent-pass slots, as ShelfView: solid first; ghosted after the floor overlays, depth prepasses first. */
const SOLID_ORDER = -1;
const GHOST_ORDER = 10;

/** Slot glow: the zone rhythm (views/ZoneView), so a slot lights like a pad when its destined box lands. */
const GLOW_PEAK = 0.35;
const GLOW_REST = 0.15;
const RISE_SHARE = 0.3;
const WAVE_GLOW = 0.28;
/**
 * The cue sticker is unlit: it glows by brightening its own colour (× 1 + gain · glow), about what the panel's emissive
 * adds to a pastel. Never below × 1: the cue never dims.
 */
const CUE_GLOW_GAIN = 1.2;

/**
 * One slot with a cue: its panel mesh (lit, its own glow material) and its cue (unlit stickers + lip tape, its own
 * material), which glow together. Lights ONLY when the slot holds its destined box (`satisfied`); breathes softly
 * while a box that fits its cue is being carried; a box that merely fits leaves it neutral (never red, never text).
 */
class SlotLight {
  private satisfied: boolean;
  private glow: number;
  private celebrateFrom = 0;
  private breathe = 0;
  private readonly celebrate = new OneShot(1.1);
  private readonly wave = new OneShot(0.75);

  constructor(
    state: SlotState,
    private readonly material: MeshStandardMaterial,
    private readonly cue: MeshBasicMaterial,
    private readonly landDelay: number,
  ) {
    this.satisfied = state.satisfied;
    this.glow = state.satisfied ? GLOW_REST : 0;
    this.apply(this.glow);
  }

  playWave(delay: number): void {
    this.wave.start(delay);
  }

  sync(satisfied: boolean, invite: number, time: number, dt: number): void {
    if (satisfied !== this.satisfied) {
      this.satisfied = satisfied;
      if (satisfied) {
        this.celebrateFrom = this.glow;
        this.celebrate.start(this.landDelay);
      } else {
        this.celebrate.stop();
      }
    }
    if (this.celebrate.step(dt)) {
      const p = this.celebrate.p;
      this.glow =
        p < RISE_SHARE
          ? lerp(this.celebrateFrom, GLOW_PEAK, easeOutCubic(p / RISE_SHARE))
          : lerp(GLOW_PEAK, GLOW_REST, easeInOutSine((p - RISE_SHARE) / (1 - RISE_SHARE)));
    } else if (!this.celebrate.active) {
      this.glow = damp(this.glow, this.satisfied ? GLOW_REST : 0, this.satisfied ? 4 : 2.2, dt);
    }
    this.breathe = damp(this.breathe, invite, 3, dt);
    const breatheGlow = this.breathe * (0.1 + 0.07 * Math.sin(time * 2.3));
    const wave = this.wave.step(dt) ? bump(this.wave.p) : 0;
    this.apply(this.glow + breatheGlow + wave * WAVE_GLOW);
  }

  private apply(glow: number): void {
    this.material.emissiveIntensity = glow;
    this.cue.color.setScalar(1 + CUE_GLOW_GAIN * Math.max(0, glow));
  }
}

/**
 * One column of a rack (a bay): its frame and the panels of its slots with a cue. Like ShelfView it fades out of the
 * way when it hides something the player needs to see, drawn in two passes (a depth-only prepass of every part, then
 * the colour) so the ghost stays a clean silhouette. Per bay, so a tall rack only fades where it hides something (its
 * cues never fade: RackView). Every material is transparent even while solid (opacity 1, depth write on): toggling
 * `transparent` would switch shader programs mid-game.
 */
export class RackBay {
  /** World bounds of the bay's frame (its slots' panels and boxes stand inside). */
  readonly bounds = new Box3();
  readonly frame: Mesh;
  private readonly parts: Mesh[] = [];
  private readonly depthPasses: Mesh[] = [];
  private readonly materials: MeshStandardMaterial[] = [];
  private opacity = 1;
  private actor = false;

  constructor(
    private readonly group: Group,
    /**
     * Bounds of the whole rack: a box reaching into them is in one of its slots or going in / out, and never makes a
     * bay ghost (an open bay's box is coarse: it would "hide" the boxes of the next column from a corner view).
     */
    readonly holds: Box3,
    readonly column: number,
    geometry: BufferGeometry,
    material: MeshStandardMaterial,
    private readonly depthOnly: Material,
  ) {
    this.frame = this.addPart(geometry, material);
    this.frame.userData.rack = true;
    this.frame.userData.column = column;
    geometry.computeBoundingBox();
    this.bounds.copy(geometry.boundingBox!);
  }

  /** Whether the bay currently hides the forklift or its load (the boxes in its slots then ghost with it). */
  get hidesActor(): boolean {
    return this.actor;
  }

  addPart(geometry: BufferGeometry, material: MeshStandardMaterial): Mesh {
    material.transparent = true;
    material.depthFunc = LessEqualDepth;
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const depthPass = new Mesh(geometry, this.depthOnly);
    depthPass.visible = false;
    mesh.add(depthPass);
    this.group.add(mesh);
    this.parts.push(mesh);
    this.depthPasses.push(depthPass);
    this.materials.push(material);
    this.apply(0);
    return mesh;
  }

  /**
   * `hiding`: the bay covers an actor; `soft`: only resting boxes or zones. `rank` orders ghosted bays and shelves back
   * to front (0 = farthest), so two ghosts overlapping on screen still blend correctly.
   */
  sync(hiding: boolean, rank: number, dt: number, soft = false): void {
    this.actor = hiding && !soft;
    const target = !hiding ? 1 : soft ? SOFT_GHOST_OPACITY : GHOST_OPACITY;
    this.opacity = damp(this.opacity, target, FADE_RATE, dt);
    if (!hiding && this.opacity > 0.995) this.opacity = 1;
    this.apply(rank);
  }

  private apply(rank: number): void {
    const ghost = this.opacity < 1;
    for (let i = 0; i < this.parts.length; i++) {
      const material = this.materials[i];
      material.opacity = this.opacity;
      material.depthWrite = !ghost;
      const depthPass = this.depthPasses[i];
      depthPass.visible = ghost;
      depthPass.renderOrder = GHOST_ORDER + rank * 2;
      this.parts[i].renderOrder = ghost ? GHOST_ORDER + rank * 2 + 1 : SOLID_ORDER;
    }
  }
}

/**
 * One storage rack (docs/RACKS.md): a bay per column (frame + a glowing panel per slot with a cue, see RackBay), the
 * cue of each such slot and its light. The cues are not part of their bay: opaque and unlit, they never fade, dim or
 * shade, even while the bay ghosts around them (drawn in the opaque pass, before any ghost, so the ghost's depth
 * prepass and colour pass simply stop at them).
 */
export class RackView {
  readonly id: string;
  readonly group = new Group();
  readonly bays: RackBay[] = [];
  /** World bounds of the whole rack. */
  readonly bounds = new Box3();
  private readonly lights = new Map<string, SlotLight>();

  constructor(
    id: string,
    /** One frame geometry per column (builders/rack buildRackBays), in world space. */
    bayGeometries: readonly BufferGeometry[],
    /** A fresh frame material per bay (each fades on its own). */
    frameMaterial: () => MeshStandardMaterial,
    depthOnly: Material,
    /** Delay before a slot lights (lets the dropped box land first). */
    private readonly landDelay: number,
  ) {
    this.id = id;
    this.group.userData.rackId = id;
    bayGeometries.forEach((geometry, column) => {
      const bay = new RackBay(this.group, this.bounds, column, geometry, frameMaterial(), depthOnly);
      this.bays.push(bay);
      this.bounds.union(bay.bounds);
    });
  }

  /**
   * A slot with a cue, from slot-local geometries (builders/rack): its panel mesh, in its bay (glows, fades with it),
   * and its cue mesh (`cueMaterial`: unlit, opaque; glows with the panel, never fades).
   */
  addSlot(
    state: SlotState,
    geometry: BufferGeometry,
    material: MeshStandardMaterial,
    cueGeometry: BufferGeometry,
    cueMaterial: MeshBasicMaterial,
  ): Mesh {
    const mesh = this.bays[state.column].addPart(geometry, material);
    const cue = new Mesh(cueGeometry, cueMaterial);
    for (const m of [mesh, cue]) {
      m.position.set(state.pos.x, rackSlotY(state.level), state.pos.z);
      m.rotation.y = outwardYaw(state.facing);
    }
    mesh.userData.slotId = state.id;
    cue.userData.slotCue = state.id;
    this.group.add(cue);
    this.lights.set(state.id, new SlotLight(state, material, cueMaterial, this.landDelay));
    return mesh;
  }

  /** The bay holding `slot` (its boxes ghost with it). */
  bayOf(slot: Pick<SlotState, 'column'>): RackBay | undefined {
    return this.bays[slot.column];
  }

  /** `invite` 0‥1: how strongly the slot breathes for the box being carried (0 = still). */
  syncSlot(state: SlotState, invite: number, time: number, dt: number): void {
    this.lights.get(state.id)?.sync(state.satisfied, invite, time, dt);
  }

  /** Level complete: a slot's panel pulses once, after `delay`. */
  playWave(slotId: string, delay: number): void {
    this.lights.get(slotId)?.playWave(delay);
  }
}
