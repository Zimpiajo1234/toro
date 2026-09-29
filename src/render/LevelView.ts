import { Box3, Color, Group, Mesh, MeshBasicMaterial, Vector3, type BufferGeometry, type Material } from 'three';
import type { GameConfig } from '../config';
import { degToRad } from '../core/math';
import { accepts, takesNext, usesSymbols } from '../core/sorting';
import {
  COLOR_IDS,
  DEFAULT_SYMBOL,
  type BoxState,
  type CellPos,
  type ColorId,
  type GameEvent,
  type GameSnapshot,
  type LevelData,
  type ZoneState,
} from '../core/types';
import type { Theme } from '../themes/types';
import { buildBoxGeometry, type LidMark } from './builders/box';
import { addFloor } from './builders/floor';
import { buildForkliftGeometry } from './builders/forklift';
import { addPlant } from './builders/plant';
import { addShelf } from './builders/shelf';
import { buildWallGeometry, toWallLocal, wallLayouts } from './builders/walls';
import { buildHaloGeometry, buildOutlineGeometry, buildRecipeGeometry, buildZoneGeometry, type ZoneMark } from './builders/zone';
import type { FitBox } from './CameraRig';
import { DIORAMA, ZONE, boxDims } from './dims';
import { GLYPH_SYMMETRY } from './glyphs';
import { createGlowMaterial, createOverlayMaterial, createSharedMaterials, type SharedMaterials } from './materials';
import { PartList } from './paint';
import { createRng } from './random';
import { ResourceBag } from './resources';
import { BoxView, DROP_GLIDE_SEC } from './views/BoxView';
import { DropPreview } from './views/DropPreview';
import { ForkliftView } from './views/ForkliftView';
import { ShelfView, hidesBehind } from './views/ShelfView';
import { WallView } from './views/WallView';
import { ZoneView } from './views/ZoneView';

/** Level-complete wave: first zone after the last drop has landed, then one every WAVE_STEP s. */
const WAVE_START_DELAY = 0.45;
const WAVE_STEP = 0.13;
/** Soft bounce-light lift on the back walls (their inner faces rarely face the sun). */
const WALL_BOUNCE = 0.3;
/**
 * Actor volumes a shelf must not hide (it ghosts instead): the forklift's cabin, the upper part of a
 * box (lid + glyph), the middle of a zone pad. Kept inside the silhouettes, so an edge or a bottom
 * corner tucked behind a shelf does not fade it.
 */
const FORKLIFT_HALF = 0.3;
const FORKLIFT_Y = [0.25, 1.0] as const;
const BOX_INSET = 0.12;
const BOX_VISIBLE_FROM = 0.4;
const ZONE_HALF = 0.3;
/**
 * Probes of the forklift cabin that a stacked box must not hide: tiny boxes CABIN_BACK behind the body center
 * (along the heading), at seat/driver height and at the roof.
 */
const CABIN_BACK = 0.1;
const CABIN_PROBE_HALF = 0.02;
const CABIN_PROBE_Y = [0.72, 1.0] as const;
/** Completed stack: each box glows in turn, bottom → top, starting once the last one has landed. */
const STACK_GLOW_START = 0.05;
const STACK_GLOW_STEP = 0.14;
/**
 * Sorting levels, while carrying a box no free zone takes: the occupied zones that accept it breathe this faintly
 * (share of the full invitation), a quiet "swap" hint. Never red, never text.
 */
const SWAP_INVITE = 0.32;

const _actorMin = new Vector3();
const _actorMax = new Vector3();
const _back = new Vector3();

/**
 * Everything drawn for one level: static diorama (a few merged meshes), walls, zones, boxes,
 * forklift and the drop preview. Owns and disposes all of its GPU resources.
 */
export class LevelView {
  readonly root = new Group();
  readonly fitBoxes: FitBox[] = [];
  /** Volume that must receive shadows (floor, walls, props). */
  readonly shadowBounds = new Box3();
  /** Unit vector toward the sun (from the window side). */
  readonly toSun = new Vector3();

  private readonly bag = new ResourceBag();
  private readonly size: { width: number; depth: number };
  private readonly forklift: ForkliftView;
  private readonly boxViews = new Map<string, BoxView>();
  private readonly boxList: BoxView[] = [];
  private readonly zoneViews = new Map<string, ZoneView>();
  /** Zone border tone per color: the drop preview takes the carried box's on a zone that takes that box. */
  private readonly borders = new Map<ColorId, Color>();
  private readonly zoneStates = new Map<string, ZoneState>();
  /** Last seen `satisfied` per stack zone (recipe of 2+), to glow a completed stack bottom → top. */
  private readonly stackSatisfied = new Map<string, boolean>();
  /** Stack levels: upper stacked boxes may ghost when they hide the forklift, a box or a zone. */
  private readonly stacking: boolean;
  /**
   * The level sorts by symbol (docs/SORTING.md): pads show the symbol they ask for (engraved) instead of their color's
   * glyph, lids print their symbol large, and a carried box nobody free takes hints at a swap.
   */
  private readonly sorting: boolean;
  private readonly stackBox = new Box3();
  private readonly walls: WallView[] = [];
  private readonly shelves: ShelfView[] = [];
  /** Per-shelf scratch for update(): hides an actor now / distance toward the camera. */
  private readonly shelfHiding: boolean[] = [];
  private readonly shelfDepth: number[] = [];
  private readonly pitch: number;
  private readonly boxHalf: number;
  private readonly boxHeight: number;
  private readonly glassMaterial: MeshBasicMaterial;
  private readonly preview: DropPreview;

  constructor(snapshot: GameSnapshot, theme: Theme, config: GameConfig, cameraYaw: number) {
    const level = snapshot.level;
    this.size = { ...level.size };
    this.pitch = degToRad(config.camera.pitchDeg);
    const dims = boxDims(config);
    this.boxHalf = dims.size / 2 - BOX_INSET;
    this.boxHeight = dims.height;
    this.stacking = (level.stackLimit ?? 1) > 1;
    this.sorting = usesSymbols(level);
    for (const c of COLOR_IDS) this.borders.set(c, new Color(theme.zones[c].border));
    const mats = createSharedMaterials(this.bag);
    // Glass gets its own copy so level-complete warmth can tint it (each wall clones its shafts').
    this.glassMaterial = this.bag.track(mats.unlit.clone());
    sunDirection(level, this.toSun);

    this.buildStatic(level, theme, mats);
    this.buildWalls(level, theme, mats, cameraYaw);
    this.buildZones(snapshot, theme, mats);
    this.buildBoxes(snapshot, theme, config);

    const fl = buildForkliftGeometry(theme, {
      wheelRadius: config.forklift.wheelRadius,
      forkReach: config.forklift.forkReach,
      boxSize: config.box.size,
    });
    for (const g of Object.values(fl)) this.bag.track(g);
    this.forklift = new ForkliftView(
      fl,
      mats,
      {
        maxSpeed: config.forklift.maxSpeed,
        wheelRadius: config.forklift.wheelRadius,
        forkReach: config.forklift.forkReach,
        stackStep: dims.height,
      },
      snapshot.forklift,
    );
    this.root.add(this.forklift.root);

    const outline = this.bag.track(buildOutlineGeometry(0.5, 0.045, 0.12));
    const previewMat = createOverlayMaterial(this.bag, theme.floor.edge, 0);
    this.preview = new DropPreview(outline, previewMat, new Color(theme.floor.edge), this.size);
    this.root.add(this.preview.mesh);

    const { width: w, depth: d } = level.size;
    const t = DIORAMA.wallThickness + DIORAMA.capOverhang;
    this.shadowBounds.set(new Vector3(-w / 2 - t, -DIORAMA.slabThickness, -d / 2 - t), new Vector3(w / 2, DIORAMA.wallHeight, d / 2));
    this.fitBoxes.unshift({
      min: new Vector3(-w / 2, -DIORAMA.slabThickness, -d / 2),
      max: new Vector3(w / 2, DIORAMA.contentHeight, d / 2),
      heightScale: 1,
    });

    this.update(snapshot, 0, 0, cameraYaw, 0);
  }

  update(snapshot: GameSnapshot, dt: number, time: number, cameraYaw: number, warmth: number): void {
    const f = snapshot.forklift;
    this.forklift.sync(f, dt, time);
    this.forklift.root.updateMatrixWorld(true);

    let carried: BoxState | null = null;
    const boxes = snapshot.boxes;
    const target = snapshot.hint.targetBoxId;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      const view = this.boxViews.get(box.id);
      if (!view) continue;
      if (box.carried) carried = box;
      view.sync(box, this.forklift.anchor, box.id === target, dt);
    }

    // Teach the goal without words: the zones that would take the carried box breathe. In a sorting level, when no
    // free zone takes it, the occupied zones that accept it breathe very faintly instead: the box resting there could
    // move on (a swap hint).
    const zones = snapshot.zones;
    let anyTakes = false;
    if (carried) for (let i = 0; i < zones.length && !anyTakes; i++) anyTakes = takesNext(zones[i], carried);
    for (let i = 0; i < zones.length; i++) {
      const zone = zones[i];
      const takes = carried !== null && takesNext(zone, carried);
      const swap = carried !== null && this.sorting && !anyTakes && zone.stack.length > 0 && accepts(zone, carried);
      this.zoneViews.get(zone.id)?.sync(zone, takes ? 1 : swap ? SWAP_INVITE : 0, takes, time, dt);
      const was = this.stackSatisfied.get(zone.id);
      if (was !== undefined && was !== zone.satisfied) {
        this.stackSatisfied.set(zone.id, zone.satisfied);
        if (zone.satisfied) this.glowStack(zone);
      }
    }

    // The preview takes the carried box's zone tone when it would land on a zone that takes that box.
    const hint = snapshot.hint;
    const dropZone = hint.dropZoneId ? this.zoneStates.get(hint.dropZoneId) : undefined;
    const match = dropZone && carried && takesNext(dropZone, carried) ? (this.borders.get(carried.color) ?? null) : null;
    this.preview.sync(f.carrying ? hint.dropCell : null, match, dt, hint.dropLevel * this.boxHeight);

    this.updateShelves(snapshot, cameraYaw, dt);
    if (this.stacking) this.updateStackGhosts(snapshot, cameraYaw, dt);

    const shaftGain = 1 + 0.2 * warmth;
    for (let i = 0; i < this.walls.length; i++) this.walls[i].sync(cameraYaw, dt, false, shaftGain);
    this.glassMaterial.color.setScalar(1 + 0.06 * warmth);
  }

  handleEvent(event: GameEvent, snapshot: GameSnapshot): void {
    switch (event.type) {
      case 'actionIdle':
        if (event.carrying && snapshot.forklift.carrying) this.boxViews.get(snapshot.forklift.carrying)?.playWobble();
        else this.forklift.playShrug();
        break;
      case 'levelComplete':
        this.playCompletionWave(snapshot);
        break;
      case 'boxDropped':
        // Stacked on top: as it lands, the whole stack (the new box included) dips a touch together.
        if (event.level > 0) {
          for (const box of snapshot.boxes) {
            if (box.cell && box.cell.x === event.cell.x && box.cell.z === event.cell.z) {
              this.boxViews.get(box.id)?.playStackSettle(DROP_GLIDE_SEC);
            }
          }
        }
        break;
      default:
        // Pick hops, drop glides, zone glow and release are derived from state changes in update().
        break;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.bag.dispose();
  }

  /**
   * Ghost every shelf that stands between the camera and the forklift, a box or a zone, so tall
   * shelves never hide what the player needs to see; back to solid once nothing is behind it.
   */
  private updateShelves(snapshot: GameSnapshot, cameraYaw: number, dt: number): void {
    const n = this.shelves.length;
    if (n === 0) return;
    const cp = Math.cos(this.pitch);
    const back = _back.set(cp * Math.sin(cameraYaw), Math.sin(this.pitch), cp * Math.cos(cameraYaw));
    const f = snapshot.forklift.pos;
    for (let i = 0; i < n; i++) {
      const bounds = this.shelves[i].bounds;
      _actorMin.set(f.x - FORKLIFT_HALF, FORKLIFT_Y[0], f.z - FORKLIFT_HALF);
      _actorMax.set(f.x + FORKLIFT_HALF, FORKLIFT_Y[1], f.z + FORKLIFT_HALF);
      let hiding = hidesBehind(bounds, _actorMin, _actorMax, back);
      for (let b = 0; b < this.boxList.length && !hiding; b++) {
        const p = this.boxList[b].group.position;
        _actorMin.set(p.x - this.boxHalf, p.y + this.boxHeight * BOX_VISIBLE_FROM, p.z - this.boxHalf);
        _actorMax.set(p.x + this.boxHalf, p.y + this.boxHeight, p.z + this.boxHalf);
        hiding = hidesBehind(bounds, _actorMin, _actorMax, back);
      }
      const zones = snapshot.zones;
      for (let z = 0; z < zones.length && !hiding; z++) {
        const p = zones[z].pos;
        _actorMin.set(p.x - ZONE_HALF, 0, p.z - ZONE_HALF);
        _actorMax.set(p.x + ZONE_HALF, ZONE.padHeight, p.z + ZONE_HALF);
        hiding = hidesBehind(bounds, _actorMin, _actorMax, back);
      }
      this.shelfHiding[i] = hiding;
      this.shelfDepth[i] = (bounds.min.x + bounds.max.x) * back.x + (bounds.min.z + bounds.max.z) * back.z;
    }
    // Ghosts draw back to front (rank 0 = farthest from the camera).
    for (let i = 0; i < n; i++) {
      let rank = 0;
      for (let j = 0; j < n; j++) {
        if (this.shelfDepth[j] < this.shelfDepth[i] || (this.shelfDepth[j] === this.shelfDepth[i] && j < i)) rank++;
      }
      this.shelves[i].sync(this.shelfHiding[i], rank, dt);
    }
  }

  /** Zones glow one after another, starting from the one nearest the forklift (a stack glows bottom → top). */
  private playCompletionWave(snapshot: GameSnapshot): void {
    const p = snapshot.forklift.pos;
    const order = snapshot.zones
      .map((z) => ({ id: z.id, stack: z.stack, d: Math.hypot(z.pos.x - p.x, z.pos.z - p.z) }))
      .sort((a, b) => a.d - b.d);
    order.forEach((z, i) => {
      const delay = WAVE_START_DELAY + i * WAVE_STEP;
      this.zoneViews.get(z.id)?.playWave(delay);
      // Boxes in a stack only glow (no bob), so they keep touching.
      const bob = z.stack.length <= 1;
      z.stack.forEach((id, level) => this.boxViews.get(id)?.playWave(delay + level * WAVE_STEP * 0.5, bob));
    });
    this.forklift.playHappy(WAVE_START_DELAY);
  }

  /** A stack zone was just completed: its boxes glow one after another, bottom → top, once the last has landed. */
  private glowStack(zone: ZoneState): void {
    zone.stack.forEach((id, level) =>
      this.boxViews.get(id)?.playWave(DROP_GLIDE_SEC + STACK_GLOW_START + level * STACK_GLOW_STEP, false),
    );
  }

  /**
   * Stack levels: a box resting above the floor fades to a ghost (same idea as the shelves) while it stands
   * between the camera and the forklift's cabin, another box's lid or a zone pad, so tall stacks never hide
   * what the player needs to see. Boxes on the floor stay solid, so a stack still reads as a stack.
   */
  private updateStackGhosts(snapshot: GameSnapshot, cameraYaw: number, dt: number): void {
    const cp = Math.cos(this.pitch);
    const back = _back.set(cp * Math.sin(cameraYaw), Math.sin(this.pitch), cp * Math.cos(cameraYaw));
    const boxes = snapshot.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      const view = this.boxViews.get(box.id);
      if (!view) continue;
      // Once complete (input frozen) every box turns solid, so the glow wave always plays on solid stacks.
      const hides = !snapshot.completed && !box.carried && box.level > 0 && box.cell !== null;
      view.setGhost(hides && this.stackBoxHides(box.cell!, view, snapshot, back), dt);
    }
  }

  /** True when the stacked box `view` (resting on `cell`) hides the cabin, a box lid in another cell or a zone pad. */
  private stackBoxHides(cell: CellPos, view: BoxView, snapshot: GameSnapshot, back: Vector3): boolean {
    const p = view.group.position;
    const half = this.boxHalf + BOX_INSET;
    const stack = this.stackBox;
    stack.min.set(p.x - half, p.y, p.z - half);
    stack.max.set(p.x + half, p.y + this.boxHeight, p.z + half);

    // Cabin: small probes (seat level, roof) rather than the whole forklift, so a stack being docked at stays solid.
    const f = snapshot.forklift;
    const cx = f.pos.x - CABIN_BACK * Math.sin(f.heading);
    const cz = f.pos.z - CABIN_BACK * Math.cos(f.heading);
    for (let k = 0; k < CABIN_PROBE_Y.length; k++) {
      const y = CABIN_PROBE_Y[k];
      _actorMin.set(cx - CABIN_PROBE_HALF, y - CABIN_PROBE_HALF, cz - CABIN_PROBE_HALF);
      _actorMax.set(cx + CABIN_PROBE_HALF, y + CABIN_PROBE_HALF, cz + CABIN_PROBE_HALF);
      if (hidesBehind(stack, _actorMin, _actorMax, back)) return true;
    }

    // Lids of resting boxes in other cells (same volume the shelves test).
    const boxes = snapshot.boxes;
    for (let j = 0; j < boxes.length; j++) {
      const other = boxes[j];
      if (other.carried || !other.cell || (other.cell.x === cell.x && other.cell.z === cell.z)) continue;
      const q = this.boxViews.get(other.id)?.group.position;
      if (!q) continue;
      _actorMin.set(q.x - this.boxHalf, q.y + this.boxHeight * BOX_VISIBLE_FROM, q.z - this.boxHalf);
      _actorMax.set(q.x + this.boxHalf, q.y + this.boxHeight, q.z + this.boxHalf);
      if (hidesBehind(stack, _actorMin, _actorMax, back)) return true;
    }

    // Zone pads in other cells (the one under this stack is covered by its base box anyway).
    const zones = snapshot.zones;
    for (let z = 0; z < zones.length; z++) {
      const zone = zones[z];
      if (zone.cell.x === cell.x && zone.cell.z === cell.z) continue;
      _actorMin.set(zone.pos.x - ZONE_HALF, 0, zone.pos.z - ZONE_HALF);
      _actorMax.set(zone.pos.x + ZONE_HALF, ZONE.padHeight, zone.pos.z + ZONE_HALF);
      if (hidesBehind(stack, _actorMin, _actorMax, back)) return true;
    }
    return false;
  }

  private mesh(geometry: BufferGeometry, material: Material, cast: boolean): Mesh {
    const m = new Mesh(this.bag.track(geometry), material);
    m.castShadow = cast;
    m.receiveShadow = true;
    return m;
  }

  private buildStatic(level: LevelData, theme: Theme, mats: SharedMaterials): void {
    const rng = createRng(`${level.id}:decor`);
    const floor = new PartList();
    addFloor(floor, level, theme);
    this.root.add(this.mesh(floor.build(), mats.painted, false));

    // Each shelf is its own mesh (it may fade out of the way); plants stay merged.
    const depthOnly = this.bag.track(new MeshBasicMaterial({ colorWrite: false, transparent: true }));
    for (const shelf of level.shelves) {
      const parts = new PartList();
      addShelf(parts, shelf, level, theme, rng);
      const view = new ShelfView(this.bag.track(parts.build()), this.bag.track(mats.painted.clone()), depthOnly);
      this.shelves.push(view);
      this.shelfHiding.push(false);
      this.shelfDepth.push(0);
      this.root.add(view.mesh);
    }
    const solid = new PartList();
    const leaves = new PartList();
    for (const plant of level.decor.plants) addPlant(solid, leaves, plant, level, theme, rng);
    if (!solid.isEmpty) this.root.add(this.mesh(solid.build(), mats.painted, true));
    if (!leaves.isEmpty) this.root.add(this.mesh(leaves.build(), mats.faceted, true));
  }

  private buildWalls(level: LevelData, theme: Theme, mats: SharedMaterials, cameraYaw: number): void {
    const local = new Vector3();
    const wallMaterial = createGlowMaterial(this.bag, theme.wall.base);
    wallMaterial.emissiveIntensity = WALL_BOUNCE;
    for (const layout of wallLayouts(level)) {
      const geo = buildWallGeometry(layout, theme, toWallLocal(layout, this.toSun, local));
      const min = new Vector3(layout.start, -DIORAMA.slabThickness, -DIORAMA.wallThickness - DIORAMA.capOverhang);
      const max = new Vector3(layout.end, DIORAMA.wallHeight + DIORAMA.capHeight, DIORAMA.capOverhang);
      const wall = new WallView(layout.inward, ...worldBox(min, max, layout.position, layout.rotationY));
      wall.group.position.copy(layout.position);
      wall.group.rotation.y = layout.rotationY;
      wall.group.add(this.mesh(geo.body, wallMaterial, false));
      if (geo.glass) wall.group.add(new Mesh(this.bag.track(geo.glass), this.glassMaterial));
      if (geo.shafts) wall.addShafts(this.bag.track(geo.shafts), this.bag.track(mats.shaft.clone()));
      wall.sync(cameraYaw, 0, true);
      this.walls.push(wall);
      this.fitBoxes.push(wall.fitBox);
      this.root.add(wall.group);
    }
  }

  /**
   * What a pad shows in its middle. Levels that never name a symbol: its color's glyph, tone on tone (a colour-blind
   * aid, as always). Sorting levels: the symbol the zone asks for, engraved, or nothing when it asks for none.
   */
  private zoneMark(zone: ZoneState): ZoneMark | null {
    if (!this.sorting) return zone.color ? { shape: DEFAULT_SYMBOL[zone.color], style: 'glyph' } : null;
    return zone.accepts.symbol ? { shape: zone.accepts.symbol, style: 'engraved' } : null;
  }

  private buildZones(snapshot: GameSnapshot, theme: Theme, mats: SharedMaterials): void {
    const ring = this.bag.track(buildOutlineGeometry(ZONE.padHalf, 0.035, ZONE.padRadius));
    const halo = this.bag.track(buildHaloGeometry());
    const padByLook = new Map<string, BufferGeometry>();
    for (const zone of snapshot.zones) {
      // Pad color = the color criterion; a zone that asks for none gets the neutral pad.
      const palette = zone.color ? theme.zones[zone.color] : theme.neutralZone;
      const mark = this.zoneMark(zone);
      const look = `${zone.color ?? 'neutral'}/${mark ? `${mark.style}:${mark.shape}` : 'plain'}`;
      let pad = padByLook.get(look);
      if (!pad) {
        pad = this.bag.track(buildZoneGeometry(palette, mark));
        padByLook.set(look, pad);
      }
      const view = new ZoneView(
        zone,
        { pad, ring, halo },
        createGlowMaterial(this.bag, palette.glow),
        createOverlayMaterial(this.bag, palette.border, 0),
        createOverlayMaterial(this.bag, palette.glow, 0, true),
        DROP_GLIDE_SEC,
      );
      this.zoneViews.set(zone.id, view);
      this.zoneStates.set(zone.id, zone);
      // Stack recipes are color-only (validateLevel): every step names its color.
      const recipe = zone.recipe.filter((c): c is ColorId => c !== null);
      if (recipe.length > 1) {
        // The recipe, bottom → top: a cream base (shared material) and one mesh per step that can glow on its own.
        // Neutral cream of the walls: never a functional hue.
        const marker = buildRecipeGeometry(
          recipe.map((c) => theme.boxes[c].base),
          theme.wall.base,
        );
        const steps = marker.steps.map(
          (geo, i) => new Mesh(this.bag.track(geo), createGlowMaterial(this.bag, theme.zones[recipe[i]].glow)),
        );
        for (const step of steps) step.receiveShadow = true;
        view.addRecipe(this.mesh(marker.base, mats.painted, false), steps);
        this.stackSatisfied.set(zone.id, zone.satisfied);
      }
      this.root.add(view.group);
    }
  }

  private buildBoxes(snapshot: GameSnapshot, theme: Theme, config: GameConfig): void {
    const dims = boxDims(config);
    const geoByKey = new Map<string, BufferGeometry>();
    // The lid shows the box's own symbol: the small tone-on-tone glyph, or printed large where symbols sort.
    const mark: LidMark = this.sorting ? 'symbol' : 'glyph';
    for (const box of snapshot.boxes) {
      const key = `${box.kind}:${box.color}:${box.symbol}`;
      let geo = geoByKey.get(key);
      if (!geo) {
        geo = this.bag.track(buildBoxGeometry(box.kind, theme.boxes[box.color], box.symbol, dims, mark));
        geoByKey.set(key, geo);
      }
      const view = new BoxView(
        box,
        geo,
        createGlowMaterial(this.bag, theme.zones[box.color].glow),
        GLYPH_SYMMETRY[box.symbol],
        dims.height,
        this.stacking,
      );
      this.boxViews.set(box.id, view);
      this.boxList.push(view);
      this.root.add(view.group);
    }
  }
}

/**
 * Sun over the wall with more windows (north by default), ~55° high and raking along that wall toward
 * the open side, so exactly one camera-facing side of every object is lit: clear, calm volumes.
 */
function sunDirection(level: LevelData, target: Vector3): Vector3 {
  let north = 0;
  let west = 0;
  for (const w of level.decor.windows) {
    if (w.wall === 'north') north += w.width;
    else west += w.width;
  }
  if (west > north) return target.set(-0.72, 1.35, 0.62).normalize();
  return target.set(0.62, 1.35, -0.72).normalize();
}

/** World AABB of a local box after a Y rotation + translation. */
function worldBox(min: Vector3, max: Vector3, position: Vector3, rotationY: number): [Vector3, Vector3] {
  const box = new Box3(min, max);
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  const out = new Box3();
  const p = new Vector3();
  for (let i = 0; i < 8; i++) {
    p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    out.expandByPoint(new Vector3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c).add(position));
  }
  return [out.min, out.max];
}
