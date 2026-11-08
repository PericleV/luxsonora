// Loaders for the Magenta models (downloaded at runtime, decision 22):
//   mel_chords             MusicVAE, two-bar melodies conditioned on triads (Story melody)
//   chord_pitches_improv   ImprovRNN, a melody LSTM conditioned on chords (Improvise melody)
//   groovae_2bar_humanize  GrooVAE, turns quantized drums into a played performance (Human groove)
// Every model is used without sampling (no temperature): the most likely output at every
// step, so the same input gives the same result. TensorFlow.js runs on WebGL when it can
// (about 40× faster than the CPU here, with the same notes on the tested machine) and falls
// back to the CPU backend.
const BASE = "https://storage.googleapis.com/magentadata/js/checkpoints/";
export const MODEL_URL = BASE + "music_vae/mel_chords";
export const IMPROV_URL = BASE + "music_rnn/chord_pitches_improv";
export const GROOVE_URL = BASE + "music_vae/groovae_2bar_humanize";

let tfLoading = null;
export function tfReady() {
  if (!tfLoading) {
    tfLoading = (async () => {
      const tf = await import("@tensorflow/tfjs");
      let ok = false;
      try { ok = await tf.setBackend("webgl"); } catch (e) { ok = false; }
      if (!ok) await tf.setBackend("cpu");
      await tf.ready();
      return tf;
    })();
    tfLoading.catch(() => { tfLoading = null; });
  }
  return tfLoading;
}
const models = new Map();
function load(url, kind) {
  if (!models.has(url)) {
    const p = (async () => {
      const tf = await tfReady();
      const mod = kind === "rnn" ? await import("@magenta/music/esm/music_rnn") : await import("@magenta/music/esm/music_vae");
      const model = kind === "rnn" ? new mod.MusicRNN(url) : new mod.MusicVAE(url);
      await model.initialize();
      return { model, tf, backend: tf.getBackend() };
    })();
    p.catch(() => models.delete(url));
    models.set(url, p);
  }
  return models.get(url);
}

// Story melody adapter: plain arrays in and out, tensors disposed here.
export async function modelApi() {
  const { model: vae, tf, backend } = await load(MODEL_URL, "vae");
  return {
    backend,
    // seeds: NoteSequences of 32 steps; returns one latent vector (array) per seed
    async encode(seeds, chord) {
      const z = await vae.encode(seeds, { chordProgression: [chord] });
      const out = await z.array(); z.dispose(); return out;
    },
    // z: latent vector (array); chords: 32 chord symbols; returns the decoded NoteSequence
    async decode(z, chords) {
      const zt = tf.tensor2d([z]);
      const [seq] = await vae.decode(zt, undefined, { chordProgression: chords });
      zt.dispose(); return seq;
    }
  };
}

// Improvise adapter: continue a quantized seed for `steps` sixteenths over per-step chords.
export async function improvApi() {
  const { model: rnn, backend } = await load(IMPROV_URL, "rnn");
  return {
    backend,
    async continue(seed, steps, chords) { return rnn.continueSequence(seed, steps, undefined, chords); }
  };
}

// Groove adapter: humanize two-bar drum windows (unquantized NoteSequences) in one batch.
export async function grooveApi() {
  const { model: vae, tf, backend } = await load(GROOVE_URL, "vae");
  return {
    backend,
    async humanize(seqs, qpm) {
      const z = await vae.encode(seqs);
      const out = await vae.decode(z, undefined, undefined, 4, qpm);
      z.dispose(); return out;
    }
  };
}

// Kept for callers that only need the story model.
export function loadModel() { return load(MODEL_URL, "vae").then(m => ({ vae: m.model, tf: m.tf, backend: m.backend })); }
