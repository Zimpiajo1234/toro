/**
 * The song's tempo (audio/music/timing.ts builds the musical grid on it), shared so what moves outside the audio can
 * keep time with the music: the reverse beeper strikes once per beat, and the beacon on the forklift's roof turns with
 * it (render/views/ForkliftView.ts), without the render importing the audio.
 */
export const BPM = 70;

/** One beat, seconds (≈ 0.857 s at 70 BPM). */
export const BEAT_SEC = 60 / BPM;
