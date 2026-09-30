import { Box3, Mesh, Vector3, type BufferGeometry, type Group } from 'three';
import { dockRailsOf } from '../../core/docks';
import type { LevelStorage, StorageSlotState, WallSide } from '../../core/types';
import {
  TRUCK_BURST,
  buildDockPlate,
  buildDockRails,
  buildSignCue,
  buildSignFrame,
  buildSignGlowGeometry,
  buildSignMarkerGeometry,
  buildSignPanel,
  buildTruckBody,
  dockColumnX,
  dockPlacement,
  dockToWorld,
  signCell,
  signMidZ,
  signRowY,
  type DockShape,
} from '../builders/truck';
import type { FitBox } from '../CameraRig';
import { DIORAMA } from '../dims';
import type { SlotTone } from '../views/RackView';
import { TruckView } from '../views/TruckView';
import { cueLookOf, levelLightOf, metalMaterial, yawTowardCamera } from './common';
import type { BeyondWall, BurstPlace, MarkerPlace, Occluder, StorageSkinRender, StorageUnitView } from './types';

/*
 * The `truck` skin (docs/DOCKS.md): an adapter over builders/truck and views/TruckView, static, outside its dock door
 * (builders/walls draws the door itself in its wall, for every unit of the `door` access): the dock plate in the door,
 * the truck parked outside (its bed level with the floor: the boxes on it are ordinary boxes, a stack like the floor's)
 * and the sign over the door, a piece that fades on its own like a rack bay, with one cell per bed column and level
 * (bottom row = level 0): a glowing panel, the level's unlit sticker on both faces and a glow band round it (none on a
 * «libre» level: a plain panel of the frame). Its forks go by the keys (docs/STORAGE.md rule 9), so the chosen-level
 * marker (views/SlotMarker) frames the sign cell of the level F / V selected. The guard rails beside the door
 * (core/docks dockRailsOf) stand in its group, low static props like the plants.
 */

/** A truck as its builders read it (builders/truck DockShape): its wall, its first door cell, its bed columns' cues. */
function dockShapeOf(unit: LevelStorage): DockShape {
  if (unit.access.kind !== 'door') throw new Error(`storage unit ${unit.id}: a truck is loaded through a dock door`);
  return { wall: unit.access.wall, x: unit.x, z: unit.z, columns: unit.columns };
}

/** One dock on screen: its sign lights its levels and ghosts, and the marker frames the cell of the chosen level. */
class TruckUnit implements StorageUnitView {
  readonly id: string;
  readonly group: Group;
  readonly bounds: Box3;
  readonly fitBox: FitBox;
  readonly occluders: readonly Occluder[];
  readonly beyondWall: BeyondWall;

  constructor(
    private readonly view: TruckView,
    side: WallSide,
    /** One stack level (the box height): a box on the bed rests at floor stack heights. */
    private readonly boxHeight: number,
    /** Where the marker frames each of its levels (by slot id): its sign cell, facing the warehouse. */
    private readonly signCells: ReadonlyMap<string, Readonly<MarkerPlace>>,
  ) {
    this.id = view.id;
    this.group = view.group;
    this.bounds = view.bounds;
    this.fitBox = view.fitBox;
    this.occluders = [view.occluder];
    this.beyondWall = {
      side,
      follow: (heightScale) => view.followWall(heightScale),
      get stands() {
        return view.wallStands;
      },
    };
  }

  syncSlot(slot: StorageSlotState, invite: number, carried: SlotTone | null, time: number, dt: number): void {
    this.view.syncLevel(slot.id, slot.satisfied, invite, carried, time, dt);
  }

  playWave(slotId: string, delay: number): void {
    this.view.playWave(slotId, delay);
  }

  /**
   * A ring around the box on its bed and sparkles out of it, on the face of its bed column the camera sees (the door
   * plane from inside, the outer end of the bed from outside). Its sign cell flashes with it (views/TruckView).
   */
  burstAt(slot: StorageSlotState, cameraYaw: number, out: BurstPlace): BurstPlace {
    const h = this.boxHeight;
    out.x = slot.pos.x;
    out.y = slot.level * h;
    out.z = slot.pos.z;
    out.yaw = yawTowardCamera(slot.facing, cameraYaw);
    out.halfW = TRUCK_BURST.halfW;
    out.halfH = h / 2;
    return out;
  }

  /**
   * The forks go by the keys at the truck too (docs/STORAGE.md rule 9): the marker frames the level's cell on the sign
   * over the door (dockColumnX, signRowY, signMidZ), turned like the sign.
   */
  markerAt(slot: StorageSlotState, out: MarkerPlace): MarkerPlace | null {
    const cell = this.signCells.get(slot.id);
    if (!cell) return null;
    out.x = cell.x;
    out.y = cell.y;
    out.z = cell.z;
    out.yaw = cell.yaw;
    return out;
  }

  /** Its boxes are a stack like the floor's: they ghost as a stack, never with the sign. */
  hidesActorAt(): boolean {
    return false;
  }
}

export const TRUCK_RENDER: StorageSkinRender = {
  markerGeometry: buildSignMarkerGeometry,
  builder(ctx) {
    const { level, theme, bag, mats } = ctx;
    // Shared by every dock of the level: one glow band, one panel per cell opening, one sticker per look.
    const band = bag.track(buildSignGlowGeometry());
    const panelByCell = new Map<string, BufferGeometry>();
    const cueByLook = new Map<string, BufferGeometry>();
    const origin = new Vector3();
    const rails = dockRailsOf(level);
    // Each driveway a hair lower than the one before (builders/truck buildTruckBody): its place among the level's trucks.
    let index = 0;
    return {
      build(unit, slots) {
        const truck = dockShapeOf(unit);
        const wall = ctx.wall(truck.wall);
        // The bed columns' volume beyond the wall (dock-local −1 < z < −T over the door run): boxes there never make the
        // sign ghost.
        const holds = new Box3();
        const ends = [dockColumnX(truck, level, 0), dockColumnX(truck, level, truck.columns.length - 1)];
        holds.expandByPoint(dockToWorld(truck.wall, level, Math.min(...ends) - 0.5, 0, -1, origin));
        holds.expandByPoint(dockToWorld(truck.wall, level, Math.max(...ends) + 0.5, DIORAMA.wallHeight, -DIORAMA.wallThickness, origin));
        const view = new TruckView(
          unit.id,
          bag.track(buildDockPlate(truck, level, theme)),
          bag.track(buildTruckBody(truck, level, theme, index++)),
          mats.painted,
          bag.track(buildSignFrame(truck, level, theme)),
          metalMaterial(ctx),
          ctx.depthOnly,
          holds,
          ctx.landDelay,
        );
        // The guard rails beside its door: low static props in the room, like the plants.
        const own = rails.filter((r) => r.unitId === unit.id);
        if (own.length > 0) {
          const mesh = new Mesh(bag.track(buildDockRails(own, level, theme)), mats.painted);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.userData.dockRails = unit.id;
          view.group.add(mesh);
        }
        // Sign cells face the warehouse: their local +z is their wall's inward side (dock-local +z).
        const yaw = dockPlacement(truck.wall, level).ry ?? 0;
        const signCells = new Map<string, MarkerPlace>();
        for (const slot of slots) {
          const at = dockToWorld(truck.wall, level, dockColumnX(truck, level, slot.column), signRowY(slot.level), signMidZ(), origin);
          signCells.set(slot.id, { x: at.x, y: at.y, z: at.z, yaw });
          const cue = slot.accepts;
          if (!cue) continue; // «libre»: its cell stays a plain panel of the frame (buildSignFrame)
          const x = dockColumnX(truck, level, slot.column);
          const cell = signCell(truck, slot.column, slot.level);
          const cellKey = `${cell.x0}/${cell.x1}/${cell.y0}/${cell.y1}`;
          let panel = panelByCell.get(cellKey);
          if (!panel) {
            panel = bag.track(buildSignPanel(theme, cell));
            panelByCell.set(cellKey, panel);
          }
          const look = cueLookOf(ctx, cue);
          const key = `${look.fill}/${look.glyph ?? 'plain'}`;
          let cueGeometry = cueByLook.get(key);
          if (!cueGeometry) {
            cueGeometry = bag.track(buildSignCue(look));
            cueByLook.set(key, cueGeometry);
          }
          const light = levelLightOf(ctx, slot, cue);
          view.addLevel(
            slot.id,
            slot.satisfied,
            dockToWorld(truck.wall, level, x, signRowY(slot.level), signMidZ(), origin),
            yaw,
            panel,
            light.panel,
            cueGeometry,
            light.cue,
            band,
            light.band,
            light.destined,
          );
        }
        view.followWall(wall.heightScale);
        return new TruckUnit(view, truck.wall, ctx.boxHeight, signCells);
      },
    };
  },
};
