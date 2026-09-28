import { Box3, Color, DirectionalLight, HemisphereLight, Sphere, Vector3, type Scene } from 'three';
import { damp } from '../core/math';
import type { Theme } from '../themes/types';

const SHADOW_MAP = 2048;
/** Soft, light shadows: calm, never harsh. */
const SHADOW_INTENSITY = 0.75;
const SHADOW_RADIUS = 3;
/** Channel multipliers applied on level complete (a slightly warmer, golden light). */
const WARM_SUN = new Color(1, 0.93, 0.8);
const WARM_SKY = new Color(1, 0.96, 0.9);
const WARM_GAIN = 0.08;
/**
 * Theme intensities are artist units. These gains map them onto three's physical lights with a soft,
 * pastel balance: shaded faces keep ~60 % of the light of lit tops, shadows stay gentle.
 */
const HEMI_GAIN = 2.1;
const SUN_GAIN = 0.5;

/** Hemisphere fill + one warm directional "window" sun with a shadow camera fitted to the level. */
export class Lighting {
  readonly hemi = new HemisphereLight();
  readonly sun = new DirectionalLight();

  private readonly sunBase = new Color();
  private readonly sunWarm = new Color();
  private readonly skyBase = new Color();
  private readonly skyWarm = new Color();
  private sunIntensity = 1;
  private hemiIntensity = 1;
  private warmth = 0;
  private warmTarget = 0;

  private readonly center = new Vector3();
  private readonly sphere = new Sphere();
  private readonly corner = new Vector3();

  constructor(scene: Scene) {
    const { sun } = this;
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = SHADOW_RADIUS;
    sun.shadow.intensity = SHADOW_INTENSITY;
    scene.add(this.hemi, sun, sun.target);
  }

  /** 0 … 1, current level-complete warmth (windows use it too). */
  get warmAmount(): number {
    return this.warmth;
  }

  applyTheme(theme: Theme): void {
    const l = theme.lighting;
    this.sunBase.set(l.sun);
    this.sunWarm.copy(this.sunBase).multiply(WARM_SUN);
    this.skyBase.set(l.hemiSky);
    this.skyWarm.copy(this.skyBase).multiply(WARM_SKY);
    this.hemi.groundColor.set(l.hemiGround);
    this.sunIntensity = l.sunIntensity * SUN_GAIN;
    this.hemiIntensity = l.hemiIntensity * HEMI_GAIN;
    this.warmth = 0;
    this.warmTarget = 0;
    this.applyWarmth();
  }

  setWarm(on: boolean): void {
    this.warmTarget = on ? 1 : 0;
  }

  /** Place the sun along `toSun` and fit its orthographic shadow camera around `bounds`. */
  aim(toSun: Vector3, bounds: Box3): void {
    const { sun } = this;
    bounds.getCenter(this.center);
    const radius = bounds.getBoundingSphere(this.sphere).radius;
    sun.position.copy(this.center).addScaledVector(toSun, radius + 4);
    sun.target.position.copy(this.center);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();

    const cam = sun.shadow.camera;
    cam.position.copy(sun.position);
    cam.lookAt(this.center);
    cam.updateMatrixWorld();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < 8; i++) {
      this.corner
        .set(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z)
        .applyMatrix4(cam.matrixWorldInverse);
      minX = Math.min(minX, this.corner.x);
      maxX = Math.max(maxX, this.corner.x);
      minY = Math.min(minY, this.corner.y);
      maxY = Math.max(maxY, this.corner.y);
      minZ = Math.min(minZ, this.corner.z);
      maxZ = Math.max(maxZ, this.corner.z);
    }
    const margin = 0.25;
    cam.left = minX - margin;
    cam.right = maxX + margin;
    cam.bottom = minY - margin;
    cam.top = maxY + margin;
    cam.near = Math.max(0.05, -maxZ - margin);
    cam.far = -minZ + margin;
    cam.updateProjectionMatrix();
    sun.shadow.needsUpdate = true;
  }

  update(dt: number): void {
    if (Math.abs(this.warmth - this.warmTarget) < 1e-4) return;
    this.warmth = damp(this.warmth, this.warmTarget, 1.6, dt);
    this.applyWarmth();
  }

  private applyWarmth(): void {
    const w = this.warmth;
    this.sun.color.lerpColors(this.sunBase, this.sunWarm, w);
    this.sun.intensity = this.sunIntensity * (1 + WARM_GAIN * w);
    this.hemi.color.lerpColors(this.skyBase, this.skyWarm, w);
    this.hemi.intensity = this.hemiIntensity;
  }
}
