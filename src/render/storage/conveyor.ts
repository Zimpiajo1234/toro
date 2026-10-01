import { Box3, Group, Mesh, MeshStandardMaterial, type BufferGeometry, type Material } from 'three';
import { conveyorOfUnit, conveyorsOf } from '../../core/conveyors';
import type { GameSnapshot, LevelStorage, StorageSlotState } from '../../core/types';
import {
  BELT,
  BELT_BURST,
  beltPlacement,
  buildBeltBand,
  buildBeltBoard,
  buildBeltCue,
  buildBeltGlowGeometry,
  buildBeltPad,
  buildBeltTray,
} from '../builders/conveyor';
import { outwardYaw } from '../builders/rack';
import type { FitBox } from '../CameraRig';
import { BeltStripes } from '../views/ConveyorView';
import { SlotLight, type SlotTone } from '../views/RackView';
import { cueLookOf, levelLightOf, yawTowardCamera } from './common';
import type { BurstPlace, MarkerPlace, StorageBuildContext, StorageSkinRender, StorageUnitView } from './types';

/*
 * The conveyor belt (docs/CONVEYOR.md): one adapter for its two skins over builders/conveyor and views/ConveyorView.
 * `beltIn`, the input: its pad in the belt's identity colour, and the band of its belt with its sliding stripes (it
 * moves: `animate` follows snapshot.conveyors). `beltOut`, the end exit: its tray rimmed in that colour, and the board
 * with the cue sticker of its level, which lights like a rack slot (views/RackView SlotLight: only with its destined
 * box; it pulses while a box that fits its cue is carried, with the target hints) — at once as the box slides in, no
 * drop glide to wait for (`landDelay` 0). Low furniture: nothing of a belt ever ghosts or keeps the camera from it; the
 * forklift never works at the end exit (no chosen-level marker), nor needs one at the input (one level).
 */

/** The belt's identity colour (Theme.conveyor.identity, by its place among the level's belts). */
function identityOf(ctx: StorageBuildContext, index: number): string {
  const palette = ctx.theme.conveyor.identity;
  return palette[((index % palette.length) + palette.length) % palette.length];
}

/** The rubber of the band, the pad and the tray: painted, with a little more sheen than the furniture. */
function rubberMaterial(ctx: StorageBuildContext): MeshStandardMaterial {
  const material = ctx.bag.track(ctx.mats.painted.clone());
  material.roughness = 0.62;
  return material;
}

/** Shared by both skins' units: nothing ghosts, nothing moves the frame. */
abstract class BeltUnit implements StorageUnitView {
  readonly group = new Group();
  readonly bounds = new Box3();
  readonly occluders = [];
  readonly beyondWall = null;
  fitBox: FitBox = { min: this.bounds.min, max: this.bounds.max };

  constructor(readonly id: string) {}

  /** The unit's bounds and static frame, once it holds all its meshes. */
  protected seal(): void {
    this.group.updateMatrixWorld(true);
    this.bounds.setFromObject(this.group);
    this.fitBox = { min: this.bounds.min.clone(), max: this.bounds.max.clone() };
  }

  protected add(geometry: BufferGeometry, material: Material, cast: boolean): Mesh {
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  syncSlot(_slot: StorageSlotState, _invite: number, _carried: SlotTone | null, _time: number, _dt: number): void {}

  playWave(_slotId: string, _delay: number): void {}

  /** A ring around the box resting at the belt's floor level, on the face the camera sees, and sparkles out of it. */
  burstAt(slot: StorageSlotState, cameraYaw: number, out: BurstPlace): BurstPlace {
    out.x = slot.pos.x;
    out.y = BELT.top;
    out.z = slot.pos.z;
    out.yaw = yawTowardCamera(slot.facing, cameraYaw);
    out.halfW = BELT_BURST.halfW;
    out.halfH = this.boxHeight() / 2;
    return out;
  }

  markerAt(_slot: StorageSlotState, _out: MarkerPlace): MarkerPlace | null {
    return null;
  }

  hidesActorAt(): boolean {
    return false;
  }

  protected abstract boxHeight(): number;
}

/** A belt's input: its pad and its band, whose stripes slide with the belt's surface. */
class BeltInputUnit extends BeltUnit {
  private readonly stripes: BeltStripes | null;
  private readonly boxHeightValue: number;

  constructor(
    ctx: StorageBuildContext,
    unit: LevelStorage,
    /** Its belt's index in level.conveyors (and snapshot.conveyors), -1 when it has none (validateLevel refuses that). */
    private readonly belt: number,
    rubber: MeshStandardMaterial,
    stripe: MeshStandardMaterial,
  ) {
    super(unit.id);
    this.group.userData.beltInId = unit.id;
    const { level, theme } = ctx;
    const pad = this.add(ctx.bag.track(buildBeltPad(unit, level, identityOf(ctx, belt))), rubber, false);
    pad.userData.beltPad = unit.id;
    const conveyor = conveyorsOf(level)[belt];
    if (conveyor && unit.access.kind === 'front') {
      const placement = beltPlacement(conveyor, unit, unit.access.facing, level);
      const band = this.add(ctx.bag.track(buildBeltBand(placement, theme)), rubber, false);
      band.userData.beltBand = conveyor.id;
      this.stripes = new BeltStripes(stripe, placement);
      ctx.bag.track(this.stripes.mesh.geometry);
      this.group.add(this.stripes.mesh);
    } else this.stripes = null;
    this.boxHeightValue = ctx.boxHeight;
    this.seal();
  }

  protected boxHeight(): number {
    return this.boxHeightValue;
  }

  /** The stripes follow the distance the belt's surface has moved (they stand still while it is stopped). */
  animate(snapshot: GameSnapshot): void {
    const state = this.belt >= 0 ? snapshot.conveyors[this.belt] : undefined;
    if (state && this.stripes) this.stripes.sync(state.travel);
  }
}

/** A belt's end exit: its tray and the board of its cue, which lights like a rack slot, at once. */
class BeltExitUnit extends BeltUnit {
  readonly landDelay = 0;
  private readonly light: SlotLight | null = null;
  private readonly boxHeightValue: number;

  constructor(ctx: StorageBuildContext, unit: LevelStorage, belt: number, slot: StorageSlotState | undefined, rubber: MeshStandardMaterial) {
    super(unit.id);
    this.group.userData.beltOutId = unit.id;
    this.boxHeightValue = ctx.boxHeight;
    const { theme } = ctx;
    const facing = unit.access.kind === 'door' ? 'south' : unit.access.facing;
    const at = { x: (slot?.pos.x ?? 0), z: (slot?.pos.z ?? 0) };
    const place = (mesh: Mesh) => {
      mesh.position.set(at.x, 0, at.z);
      mesh.rotation.y = outwardYaw(facing);
      return mesh;
    };
    const tray = place(this.add(ctx.bag.track(buildBeltTray(theme, identityOf(ctx, belt))), rubber, true));
    tray.userData.beltTray = unit.id;
    const cue = slot?.accepts ?? null;
    if (slot && cue) {
      // A cue: the board glows (its panel), the sticker brightens, a band of light round it (views/RackView SlotLight).
      const light = levelLightOf(ctx, slot, cue);
      const board = place(this.add(ctx.bag.track(buildBeltBoard(theme)), light.panel, true));
      board.userData.beltBoard = unit.id;
      const sticker = place(new Mesh(ctx.bag.track(buildBeltCue(cueLookOf(ctx, cue))), light.cue));
      sticker.userData.beltCue = slot.id;
      const band = place(new Mesh(ctx.bag.track(buildBeltGlowGeometry()), light.band));
      band.renderOrder = 1;
      band.visible = false;
      band.userData.beltGlow = slot.id;
      this.group.add(sticker, band);
      this.light = new SlotLight(slot, light.panel, light.cue, band, light.band, light.destined, this.landDelay);
    } else {
      // «Libre»: a plain board, no light.
      const board = place(this.add(ctx.bag.track(buildBeltBoard(theme)), rubber, true));
      board.userData.beltBoard = unit.id;
    }
    this.seal();
  }

  protected boxHeight(): number {
    return this.boxHeightValue;
  }

  override syncSlot(slot: StorageSlotState, invite: number, carried: SlotTone | null, time: number, dt: number): void {
    this.light?.sync(slot.satisfied, invite, carried, time, dt);
  }

  override playWave(_slotId: string, delay: number): void {
    this.light?.playWave(delay);
  }
}

/** Both skins draw through one builder per level (they share the rubber and the stripes' materials). */
function beltBuilder(ctx: StorageBuildContext): { rubber: MeshStandardMaterial; stripe: MeshStandardMaterial } {
  const stripe = ctx.bag.track(
    new MeshStandardMaterial({
      color: ctx.theme.conveyor.stripe,
      roughness: 0.62,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  return { rubber: rubberMaterial(ctx), stripe };
}

export const BELT_IN_RENDER: StorageSkinRender = {
  builder(ctx) {
    const { rubber, stripe } = beltBuilder(ctx);
    return {
      build(unit) {
        return new BeltInputUnit(ctx, unit, conveyorOfUnit(ctx.level, unit.id), rubber, stripe);
      },
    };
  },
};

export const BELT_OUT_RENDER: StorageSkinRender = {
  builder(ctx) {
    const rubber = rubberMaterial(ctx);
    return {
      build(unit, slots) {
        return new BeltExitUnit(ctx, unit, conveyorOfUnit(ctx.level, unit.id), slots[0], rubber);
      },
    };
  },
};
