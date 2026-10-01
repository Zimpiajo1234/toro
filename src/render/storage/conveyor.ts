import { Box3, Group, Mesh, MeshStandardMaterial, type BufferGeometry, type Material } from 'three';
import { conveyorOfUnit, conveyorsOf } from '../../core/conveyors';
import { baseLevelOf } from '../../core/storage';
import type { GameSnapshot, LevelStorage, StorageSlotState } from '../../core/types';
import {
  BELT_BURST,
  beltPlacement,
  beltTopY,
  buildBeltBand,
  buildBeltCue,
  buildBeltDeck,
  buildBeltFence,
  buildBeltGlowGeometry,
  buildBeltMarkerGeometry,
  buildBeltPad,
  buildBeltTable,
} from '../builders/conveyor';
import { outwardYaw } from '../builders/rack';
import type { FitBox } from '../CameraRig';
import { BeltStripes } from '../views/ConveyorView';
import { SlotLight, type SlotTone } from '../views/RackView';
import { cueLookOf, levelLightOf, yawTowardCamera } from './common';
import type { BurstPlace, MarkerPlace, StorageBuildContext, StorageSkinRender, StorageUnitView } from './types';

/*
 * The conveyor belt (docs/CONVEYOR.md): one adapter for its two skins over builders/conveyor and views/ConveyorView,
 * the belt a table at its height (H1b: its unit's base level, dims rackSlotY: a floor belt's level 1). `beltIn`, the
 * input: the belt's table, its band with the white stripes that slide (it moves: `animate` follows
 * snapshot.conveyors) and its pad in the belt's identity colour; worked like a rack slot (F up to the table top), so it
 * shows the chosen-level marker, flat round the pad, when the forks are set to its slot (none at the table's face,
 * below it). `beltOut`, the end exit: the table's last stretch, its deck with the cue sticker of its level painted flat
 * on it and its very low orange fence; it lights like a rack slot (views/RackView SlotLight: only with its destined
 * box; it pulses while a box that fits its cue is carried, with the target hints) — at once as the box slides in, no
 * drop glide to wait for (`landDelay` 0). Nothing of a belt ever ghosts (an open frame: the top, the legs, a low fence)
 * or keeps the camera from it; the forklift never works at the end exit (no marker).
 */

/** The belt's identity colour (Theme.conveyor.identity, by its place among the level's belts). */
function identityOf(ctx: StorageBuildContext, index: number): string {
  const palette = ctx.theme.conveyor.identity;
  return palette[((index % palette.length) + palette.length) % palette.length];
}

/** The rubber of the band and the pad: painted, with a little more sheen than the furniture. */
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

  constructor(
    readonly id: string,
    private readonly boxHeight: number,
  ) {}

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

  /** A ring around the box resting on the table top, on the face the camera sees, and sparkles out of it. */
  burstAt(slot: StorageSlotState, cameraYaw: number, out: BurstPlace): BurstPlace {
    out.x = slot.pos.x;
    out.y = beltTopY(slot.level);
    out.z = slot.pos.z;
    out.yaw = yawTowardCamera(slot.facing, cameraYaw);
    out.halfW = BELT_BURST.halfW;
    out.halfH = this.boxHeight / 2;
    return out;
  }

  markerAt(_slot: StorageSlotState, _out: MarkerPlace): MarkerPlace | null {
    return null;
  }

  hidesActorAt(): boolean {
    return false;
  }
}

/** A belt's input: the belt's table, its band (whose stripes slide with its surface) and its pad, on the table top. */
class BeltInputUnit extends BeltUnit {
  private readonly stripes: BeltStripes | null;

  constructor(
    ctx: StorageBuildContext,
    unit: LevelStorage,
    /** Its belt's index in level.conveyors (and snapshot.conveyors), -1 when it has none (validateLevel refuses that). */
    private readonly belt: number,
    painted: Material,
    rubber: MeshStandardMaterial,
    stripe: MeshStandardMaterial,
  ) {
    super(unit.id, ctx.boxHeight);
    this.group.userData.beltInId = unit.id;
    const { level, theme } = ctx;
    // The whole table at the input's level, its belt's height there (a floor belt is level: one height end to end).
    const top = beltTopY(baseLevelOf(unit));
    const conveyor = conveyorsOf(level)[belt];
    if (conveyor && unit.access.kind === 'front') {
      const placement = beltPlacement(conveyor, unit, unit.access.facing, level);
      const table = this.add(ctx.bag.track(buildBeltTable(placement, top, theme)), painted, true);
      table.userData.beltTable = conveyor.id;
      const band = this.add(ctx.bag.track(buildBeltBand(placement, top, theme)), rubber, false);
      band.userData.beltBand = conveyor.id;
      this.stripes = new BeltStripes(stripe, placement, top);
      ctx.bag.track(this.stripes.mesh.geometry);
      this.group.add(this.stripes.mesh);
    } else this.stripes = null;
    const pad = this.add(ctx.bag.track(buildBeltPad(unit, level, top, identityOf(ctx, belt))), rubber, false);
    pad.userData.beltPad = unit.id;
    this.seal();
  }

  /** The stripes follow the distance the belt's surface has moved (they stand still while it is stopped). */
  animate(snapshot: GameSnapshot): void {
    const state = this.belt >= 0 ? snapshot.conveyors[this.belt] : undefined;
    if (state && this.stripes) this.stripes.sync(state.travel);
  }

  /** The marker lies flat on the table top round the pad, at the chosen slot's floor. */
  override markerAt(slot: StorageSlotState, out: MarkerPlace): MarkerPlace {
    out.x = slot.pos.x;
    out.y = beltTopY(slot.level);
    out.z = slot.pos.z;
    out.yaw = outwardYaw(slot.facing);
    return out;
  }
}

/** A belt's end exit: its deck, the cue painted flat on it (lit like a rack slot, at once) and its low fence. */
class BeltExitUnit extends BeltUnit {
  readonly landDelay = 0;
  private readonly light: SlotLight | null = null;

  constructor(ctx: StorageBuildContext, unit: LevelStorage, slot: StorageSlotState | undefined, painted: Material) {
    super(unit.id, ctx.boxHeight);
    this.group.userData.beltOutId = unit.id;
    const { theme } = ctx;
    const facing = unit.access.kind === 'door' ? 'south' : unit.access.facing;
    const top = beltTopY(slot?.level ?? baseLevelOf(unit));
    const at = { x: slot?.pos.x ?? 0, z: slot?.pos.z ?? 0 };
    // Its deck and fence turn with the belt (open toward it); the sticker and its glow keep the world's axes.
    const place = (mesh: Mesh, turned: boolean) => {
      mesh.position.set(at.x, 0, at.z);
      if (turned) mesh.rotation.y = outwardYaw(facing);
      return mesh;
    };
    const fence = place(this.add(ctx.bag.track(buildBeltFence(top, theme)), painted, true), true);
    fence.userData.beltFence = unit.id;
    const cue = slot?.accepts ?? null;
    if (slot && cue) {
      // A cue: the deck glows (its panel), the sticker brightens, a band of light round it (views/RackView SlotLight).
      const light = levelLightOf(ctx, slot, cue);
      const deck = place(this.add(ctx.bag.track(buildBeltDeck(top, theme)), light.panel, false), true);
      deck.userData.beltDeck = unit.id;
      const sticker = place(new Mesh(ctx.bag.track(buildBeltCue(cueLookOf(ctx, cue), top)), light.cue), false);
      sticker.userData.beltCue = slot.id;
      const band = place(new Mesh(ctx.bag.track(buildBeltGlowGeometry(top)), light.band), false);
      band.renderOrder = 1;
      band.visible = false;
      band.userData.beltGlow = slot.id;
      this.group.add(sticker, band);
      this.light = new SlotLight(slot, light.panel, light.cue, band, light.band, light.destined, this.landDelay);
    } else {
      // «Libre»: a plain deck, no light.
      const deck = place(this.add(ctx.bag.track(buildBeltDeck(top, theme)), painted, false), true);
      deck.userData.beltDeck = unit.id;
    }
    this.seal();
  }

  override syncSlot(slot: StorageSlotState, invite: number, carried: SlotTone | null, time: number, dt: number): void {
    this.light?.sync(slot.satisfied, invite, carried, time, dt);
  }

  override playWave(_slotId: string, delay: number): void {
    this.light?.playWave(delay);
  }
}

/** The belt's stripes: white, just off the band (they slide over it), as glossy as its rubber. */
function stripeMaterial(ctx: StorageBuildContext): MeshStandardMaterial {
  return ctx.bag.track(
    new MeshStandardMaterial({
      color: ctx.theme.conveyor.stripe,
      roughness: 0.62,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
}

export const BELT_IN_RENDER: StorageSkinRender = {
  /** Worked like a rack slot: the marker frames its slot on the table top when the forks are set to it. */
  markerGeometry: buildBeltMarkerGeometry,
  builder(ctx) {
    const rubber = rubberMaterial(ctx);
    const stripe = stripeMaterial(ctx);
    return {
      build(unit) {
        return new BeltInputUnit(ctx, unit, conveyorOfUnit(ctx.level, unit.id), ctx.mats.painted, rubber, stripe);
      },
    };
  },
};

export const BELT_OUT_RENDER: StorageSkinRender = {
  builder(ctx) {
    return {
      build(unit, slots) {
        return new BeltExitUnit(ctx, unit, slots[0], ctx.mats.painted);
      },
    };
  },
};
