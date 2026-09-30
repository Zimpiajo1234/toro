import { NeutralToneMapping, PCFShadowMap, SRGBColorSpace, Scene, WebGLRenderer } from 'three';
import type { GameEvent, GameSnapshot } from '../core/types';
import type { Theme } from '../themes';
import { GAME_CONFIG, type GameConfig } from '../config';
import { CameraRig, type ViewInsets } from './CameraRig';
import { LevelView } from './LevelView';
import { Lighting } from './Lighting';

/** Per-frame renderer counters (last rendered frame, shadow pass included). */
export interface RenderStats {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

const MAX_PIXEL_RATIO = 2;

/**
 * Owns the three.js scene, camera, lights and every mesh. Reads GameSnapshot, never mutates it.
 * Game drives frames: update() advances animations and renders exactly once (no setAnimationLoop).
 */
export class GameRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly rig: CameraRig;
  private readonly lighting: Lighting;
  private readonly resizeObserver: ResizeObserver | null = null;
  private pixelRatioQuery: MediaQueryList | null = null;
  private level: LevelView | null = null;
  private time = 0;
  private disposed = false;
  /** False until the container has been laid out with a non-zero size. */
  private sized = false;
  /** A level was built and not rendered by update() yet: a zoom reset lands at once (nothing to ease from). */
  private freshLevel = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly config: GameConfig = GAME_CONFIG,
  ) {
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NeutralToneMapping;
    renderer.shadowMap.enabled = true;
    // r186 folded PCFSoftShadowMap into PCFShadowMap (soft Vogel-disk filtering driven by shadow.radius).
    renderer.shadowMap.type = PCFShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.setAttribute('aria-hidden', 'true');
    // three already preventDefault()s webglcontextlost, so the browser restores the context itself.
    container.appendChild(canvas);
    this.renderer = renderer;

    this.rig = new CameraRig(config.camera);
    this.lighting = new Lighting(this.scene);
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    }
    this.watchPixelRatio();
  }

  /** (Re)build the whole scene for a level. Disposes everything from the previous level first. */
  loadLevel(snapshot: GameSnapshot, theme: Theme): void {
    if (this.disposed) return;
    this.level?.dispose();
    this.level = null;
    this.renderer.toneMappingExposure = theme.lighting.exposure;
    this.lighting.applyTheme(theme);

    const level = new LevelView(snapshot, theme, this.config, this.rig.yaw);
    this.scene.add(level.root);
    this.level = level;
    this.rig.setFitBoxes(level.fitBoxes);
    // A new scene is a cut: the zoom (kept across a restart, reset by Game on a level change) lands on its goal and
    // the zoomed view on the forklift, with no glide over from the previous scene.
    const forklift = snapshot.forklift.pos;
    this.rig.setFollow(forklift.x, forklift.z, true);
    this.rig.settleZoom();
    this.freshLevel = true;
    this.lighting.aim(level.toSun, level.shadowBounds);
    this.rig.update(0);
    this.renderer.compile(this.scene, this.rig.camera);
  }

  /** Sync meshes to the snapshot and advance visual animations, then render once. */
  update(snapshot: GameSnapshot, dt: number): void {
    if (this.disposed) return;
    // A container hidden at construction has no size yet; retry until it is laid out.
    if (!this.sized) this.resize();
    const step = Math.max(0, dt);
    this.time += step;
    this.freshLevel = false;
    this.rig.setFollow(snapshot.forklift.pos.x, snapshot.forklift.pos.z);
    this.rig.update(step);
    this.lighting.update(step);
    this.level?.update(snapshot, step, this.time, this.rig.yaw, this.lighting.warmAmount);
    this.renderer.render(this.scene, this.rig.camera);
  }

  /** Gentle visual feedback for logic events. */
  handleEvent(event: GameEvent, snapshot: GameSnapshot): void {
    if (this.disposed || !this.level) return;
    if (event.type === 'levelComplete') this.lighting.setWarm(true);
    this.level.handleEvent(event, snapshot);
  }

  /** Smoothly rotate the camera by 90° (direction -1 = counter-clockwise, 1 = clockwise, seen from above). */
  rotateCamera(direction: -1 | 1): void {
    this.rig.rotate(direction);
  }

  /** Current (animated) camera yaw in radians; used by Game to map screen input to world space. */
  getCameraYaw(): number {
    return this.rig.yaw;
  }

  /**
   * Player zoom by a step of `deltaLog2` stops (+ = closer; 1 = twice as close; a key tap, a wheel notch), within 1
   * (the full view) … `camera.zoomMax`. The view eases there and, zoomed in, follows the forklift. Ignored during the
   * title's idle orbit.
   */
  zoomBy(deltaLog2: number): void {
    if (this.disposed) return;
    this.rig.zoomBy(deltaLog2);
  }

  /**
   * Player zoom by `deltaLog2` stops that follow the input as it moves (held keys, triggers, pinches): the view takes
   * it right away (a brief smoothing, `camera.zoomTrackSec`) and stops when the input does. Same range as zoomBy.
   */
  zoomTrack(deltaLog2: number): void {
    if (this.disposed) return;
    this.rig.zoomTrack(deltaLog2);
  }

  /**
   * Back to the full-warehouse view (zoom 1): eased from what is on screen, or at once for a level just loaded (this
   * frame, before or after loadLevel).
   */
  resetZoom(): void {
    if (this.disposed) return;
    this.rig.resetZoom(this.freshLevel);
  }

  /** Title-screen mode: very slow orbit of the diorama (always unzoomed). Turning it off glides back to a 45° view. */
  setIdleOrbit(enabled: boolean): void {
    this.rig.setIdleOrbit(enabled);
  }

  /**
   * Screen bands the DOM overlay keeps over the scene (CSS px from each canvas edge), reported when a level starts, on a
   * resize and for the title, never mid-level: the camera frames the level in the rest. It glides there with the
   * title's orbit and the glide into a level, else takes them at once (`immediate`: always at once); a level on screen
   * is redrawn right away, so the frame being painted (a new level's first, a resize's) already has them.
   */
  setViewInsets(insets: ViewInsets, immediate = false): void {
    if (this.disposed) return;
    this.rig.setInsets(insets, immediate);
    if (this.level && this.sized) {
      this.rig.update(0);
      this.renderer.render(this.scene, this.rig.camera);
    }
  }

  /** Counters of the last rendered frame (dev / diagnostics). */
  getStats(): RenderStats {
    const info = this.renderer.info;
    return {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.pixelRatioQuery?.removeEventListener('change', this.onPixelRatioChange);
    this.pixelRatioQuery = null;
    this.level?.dispose();
    this.level = null;
    this.lighting.sun.shadow.dispose();
    const canvas = this.renderer.domElement;
    this.renderer.dispose();
    // Release the GL context now: StrictMode / HMR remounts would otherwise pile up live contexts until GC
    // (browsers cap them at ~16 and then drop the oldest — possibly the one on screen).
    this.renderer.forceContextLoss();
    canvas.remove();
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    this.sized = true;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.setSize(width, height, false);
    this.rig.setAspect(width, height);
    // Resizing clears the canvas: redraw right away so it never flashes empty.
    if (this.level) {
      this.rig.update(0);
      this.renderer.render(this.scene, this.rig.camera);
    }
  }

  /**
   * Moving the window to a monitor with another scale changes devicePixelRatio but not the CSS size, so
   * the ResizeObserver stays silent: listen for the current ratio to stop matching, then re-arm.
   */
  private watchPixelRatio(): void {
    this.pixelRatioQuery?.removeEventListener('change', this.onPixelRatioChange);
    this.pixelRatioQuery = null;
    if (this.disposed || typeof window.matchMedia !== 'function') return;
    this.pixelRatioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.pixelRatioQuery.addEventListener('change', this.onPixelRatioChange);
  }

  private readonly onPixelRatioChange = (): void => {
    this.resize();
    this.watchPixelRatio();
  };
}
