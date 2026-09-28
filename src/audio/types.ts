/** Shared audio-module types (no Web Audio references, safe to import from pure code and tests). */

export type AudioScene = 'title' | 'playing' | 'complete';

/** Uniform random source in [0, 1). Injected so generative code is deterministic under test. */
export type Rng = () => number;
