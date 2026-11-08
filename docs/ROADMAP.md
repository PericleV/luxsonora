# Lux Sonora: roadmap

> **Status (2026-11-06)**
> Phase 1 done: pure core modules, equivalence with the prototype, single static `dist/index.html`.
> Phase 2a done: per-layer synthesized instruments with relative image modulation, fixed duration (15/30/60 s) with whole bars and a final cadence, new inspector and mixer. 32 tests pass; offline render gives exactly T seconds for every style.
> Research done: similar software and open-source building blocks, see [RESEARCH.md](RESEARCH.md).
> Phase 3a done: everything in English (UI, docs, code, exports), "focus point" terminology, app layout with inspector tabs and a DAW-style timeline, System / Light / Dark themes with six accent colours.
> Phase 3b done: large images and TIFF (including 16-bit and float SEM/TEM data) decoded in a worker, exact area averaging in linear light or raw units, analysis source panel.
> Phase 3c done: editable focus points (move, resize, add, delete, reorder, undo), Auto / Manual / Mixed modes, minimum distance with explicit revisits, Gaussian footprints, coverage map, project files.
> Phase 3d done: smooth transitions (leap limit within the register, common-tone chords, velocity cap, filter and pan glides) and manual key, scale, melody octave and range.
> Phase 3e done: instrument library and editor, texture wavetable, 6-band parametric EQ per channel, drive and sends, reverb, delay, chorus, compressor, limiter, export at −14 LUFS with a true-peak ceiling.
> Phase 4 started: Focus points counts distinct places, a separate Returns control caps revisits; Magenta (MusicVAE) prototype for melodies that follow the gaze path as a story, with the model downloaded at runtime and the current engine as fallback (decision 22).
> Phase 5 in progress: complete open-source release (see below).
> Next: Phase 4 (analysis rigour, validation, video export, eye-tracker import).

## Fixed constraints

- **Static page.** The build output (`dist/index.html`) must run on GitHub Pages, as a claude.ai artifact and straight from disk (`file://`). No server, no API keys. Exception: an optional music model may be downloaded at runtime (decision 22); without it the app works as before.
- **Determinism.** The same image and the same settings give the same piece in the same JavaScript engine. Across browsers the guarantee is limited by image decoding and `Math.*`; we handle it with our own resampling and tolerance-based tests.
- **Traceability.** Every note can be traced back to the focus point and the area it came from.
- **Versioned JSON contract** (`parameters.json`) between the web version and the future Python port.
- **Reuse before writing.** For effects, EQ, loudness and FFT we use proven open-source libraries (MIT/ISC) and only write our own code where nothing fits or determinism requires it.

## Decisions

1. **Radius and weight are separate.** The radius `r` decides *what* a focus point reads (Gaussian window, σ = r/2). The weight `w` decides *how much it counts* (duration, velocity). The inhibition radius only drives the automatic generator.
2. **Mixed mode.** The list of focus points is the source of truth. Manual anchors keep their position in the sequence; the automatic generator applies inhibition of return around them (with their radii) and fills the free slots in winner-take-all order.
3. **Global attention.** Control 0-1: key, mode and tempo come from the whole image (0) or from the areas covered by focus points, weighted by `w·duration` (1). Default 0.
4. **Web first**, Python later, on the same JSON contract.
5. **Semantic analysis** (Claude) exists only when the page runs as a claude.ai artifact. On GitHub Pages the panel is hidden.
6. **Timbre: per-layer instrument + relative modulation.** The image shifts instrument parameters relative to the image mean, within fixed bounds: `p = p_base · 2^(D·m)` for time and frequency, `m ∈ [−1, 1]`, `D` in octaves. One perceptual dimension per feature (edge sharpness → attack, smoothness → legato, entropy → brightness, saturation → resonance, warmth → colour). Depth: melody 100%, harmony 50%, bass brightness only, pad from the background, rhythm none.
7. **Synthesized instruments**, deterministic, no samples: Karplus-Strong pluck, 2-operator FM, unison pad, sine + filtered saw bass.
8. **Sliders** with an editable numeric value instead of knobs.
9. **Fixed duration**, default 30 s (15 and 60 s available): whole 4/4 bars (`bars = round(T · bpm_style / 240)`, `bpm = bars · 240 / T`), last bar is the cadence, the body is split between focus points in proportion to `W = 1 + 3·I` with water-filling (minimum one beat) and largest-remainder rounding on half beats.
10. **Terminology: "focus point"** everywhere (UI, docs, code), shortened to "point" only where space is tight. "Fixation" is not used.
11. **Everything in English**: interface, documentation, code comments, exported files. The app is called **Lux Sonora** (it was called Sonification until November 2026).
12. **Light and dark themes**, switchable, plus a curated choice of accent and selection colours.
13. **Analysis source** (from The vOICe, Pixelsynth): Color, Grayscale or Custom RGB mix; invert, brightness, contrast, gamma. The stage can show the processed image the analysis actually sees.
14. **Manual key, scale and octave range**, Auto by default (from Pixelsynth).
15. **Texture wavetable instrument** (from Serum's image import): the luminance profile through a focus point, resampled to one cycle, through fft.js into `createPeriodicWave`, with a capped number of harmonics.
16. **Audio engine on native Web Audio nodes** (revised in Phase 3e). Tone.js was planned, but every effect needed (biquad EQ, convolver, delay with feedback, wave-shaper drive, modulated-delay chorus, dynamics compressor) is a native node that Tone.js wraps; staying native keeps the scheduler, determinism and offline rendering already verified, and avoids about 300 kB. Libraries are used where they add real code: geotiff.js, fft.js, lufs-web.
17. **Parametric EQ** per layer and on the master (frequency, gain, Q per band; low and high cut, shelves, peaks); the curve comes from the native `getFrequencyResponse()` (weq8 was evaluated; its own interface would not follow the app's themes).
18. **Export normalized to −14 LUFS** (BS.1770-4), measured with lufs-web after verification against reference signals.
19. **Resampling in linear light** for photos and in raw units for measurement data, by exact area averaging; tone steps come after resampling.
20. **Single-channel TIFF is measurement data** (SEM, TEM, detectors): averaged in raw units, shown as measured, range Full for 8-bit and Percentile 0.5-99.5% otherwise. RGB and other photometric types are photos. Stacks are out of scope (first page).
21. **Size limits**: 300 MP on desktop, 60 MP on phones and low-memory devices; header sizes checked before decoding; the full-resolution pixels are discarded after the 2048 px working copy is made.
22. **Downloaded models are allowed** (revises the first fixed constraint, 2026-11-06). A music model (Magenta MusicVAE) may be downloaded when the page opens. The deterministic engine stays as the fallback when the model can't load (offline, `file://`, sandboxed artifacts). The model must decode deterministically and every generated note must still be traceable to its focus point.
23. **Sampled instruments are downloaded too** (2026-11-06): smplr instruments load when first used, from the smplr and gleitz sample hosts; every sampled preset has a synthesized fallback with the same envelope and filter values, so the app still sounds complete offline.
24. **Genre rules come first.** Each style keeps its genre's conventions (`RULES` in theory.js, docs §9.1); the image chooses inside them, never against them.

## Phases

### Phase 1: structure and static build
- [x] Own repository, original prototype kept in `legacy/`
- [x] Pure core in `src/core`, export in `src/export`, audio in `src/audio`, UI in `src/ui`
- [x] Equivalence test against the prototype on synthetic images
- [x] Vite build into a single HTML file, GitHub Pages workflow

### Phase 2a: timbre, duration, first inspector
- [x] Per-layer instruments and relative modulation
- [x] Mixer per layer; per-layer timbre and feature → parameter explanation in the inspector
- [x] Fixed duration with whole bars, final cadence, time split by weight
- [x] Property tests (duration, split, grid, timbre, determinism, MIDI, Karplus-Strong tuning)

### Phase 3a: English and modern layout
- [x] All UI text, docs, comments and export file names in English; "focus point" terminology; app name Lux Sonora (formerly Sonification)
- [x] App layout: slim top bar with transport, large stage with tools (Select, Add point, Auto), inspector with Piece / Point / Sound tabs, DAW-style timeline with one lane per layer (mute, solo, volume in the lane header)
- [x] Light and dark themes with a theme switch; curated accent and selection colours
- [x] Translate the documentation into `docs/documentation.md`

### Phase 3b: image ingest and analysis source
- [x] Decoding in a Web Worker with progress and Cancel; main-thread fallback when the worker can't start
- [x] Format detection by magic bytes; header sizes read before decoding; device-dependent pixel limits
- [x] TIFF through geotiff.js: 8/16/32-bit integer and float, greyscale, RGB, palette, CMYK, YCbCr; band-wise decoding; LERC and Zstandard stubbed
- [x] Exact area averaging to a 2048 px working copy (linear light for photos, raw units for data); fixes the 13% bias of the browser's low-quality downscale
- [x] Analysis source panel: channels (colour, greyscale, custom mix), intensity range for data (full, percentile, min-max), invert, brightness, contrast, gamma, crop
- [x] Image info in the Piece tab

### Phase 3c: editable focus points
- [x] Model `FocusPoint { id, x, y, r, w, source }`
- [x] Select, drag, add, delete (also right after the automatic analysis), radius handle, weight, reorder, undo/redo
- [x] Minimum distance between new points; revisits reuse the existing point (one marker)
- [x] Gaussian footprint reading (features continuous in position and radius); coverage map; pad background = what was not looked at
- [x] Auto / Manual / Mixed modes
- [x] Project save and load (image hash + settings + focus points)

### Phase 3d: smooth transitions and key control
- [x] Smooth transition control: melodic leap limit at point boundaries, chord choice by common tones (minimal voice leading), timbre and pan glide over the first beat of a point
- [x] Manual key, scale and octave range (decision 14)

### Phase 3e: sound
- [x] Instrument library per layer (current presets plus new ones) and an instrument editor
- [x] Texture wavetable instrument (decision 15)
- [x] Parametric EQ per layer and master (decision 17)
- [x] Effects: reverb (size, pre-delay, damping, mix), tempo-synced delay, chorus, drive, compressor, limiter
- [x] Export normalized to −14 LUFS (decision 18), with a peak ceiling

### Phase 5: complete open-source release (MIT)
Goal: an app that turns any image into harmonious music in a chosen style, that anyone can reproduce, extend and trust.
- [x] MIT licence, third-party notices (libraries, models and sample sets with their licences)
- [x] **Reproducible recipe**: one file with the image (embedded up to 25 MB), every setting, the gaze path, the versions of app, models and instruments, the neural results (melody, groove, attention map) and a hash of the score; opening it rebuilds the piece and reports "identical" or what differs; included in the export archive
- [x] **Placement algorithms** (where the focus points go), selectable, each shown in the attention view:
  - classic: region contrast (current), spectral residual (Hou and Zhang), frequency-tuned (Achanta), Itti-Koch multi-scale, details (blobs and corners, for SEM/TEM), composition (thirds and horizon), scan (left to right)
  - neural: objects (COCO-SSD, 80 classes; people weighted toward the head; categories feed the timbre), learned saliency (MSI-Net, trained on eye-tracking data)
  - neural maps are quantized and stored in the recipe so the path stays reproducible
- [x] **Instrument catalog**: all 128 General MIDI soundfonts by family, mellotrons and VCSL mallets, 5 classic and 220 DrumAbuse drum machines; a picker with search, families and a Listen button
- [x] **UI/UX**: first-run guide (photo, style, play), clearer Piece tab order, one status chip for downloads, instrument and kit picker dialog, keyboard shortcut help, About dialog with licence and credits
- [x] Tests for every algorithm and the recipe round trip; documentation; build; browser check

### Phase 4: analysis rigour, validation, extras
- [x] Own resampling (Phase 3b)
- [x] Focus points counts distinct places; separate Returns control (revisits)
- [x] Story melody prototype: Magenta MusicVAE `mel_chords`, downloaded at runtime, conditioned on the image's chords, themes per place interpolated along the gaze path (decision 22)
- [x] Story: repeated notes held and short rests filled (legato), sustained default lead per style
- [x] Pad that follows the chords with minimal voice leading, holds common tones and takes the timbre of the background around each point
- [x] Dramatic arc over the path (introduction, development, climax, resolution) driving dynamics, entries, density and articulation
- [x] Rhythm: drum kit per style, euclidean patterns per area, fills, crash at the climax
- [x] Accompaniment articulations per area: held, pulsing, arpeggiated or broken chords; bass variants
- [x] Orchestration: melody doubled at the climax, vibrato on sustained leads
- [x] Genre rules per style (chord grid, drum phrases, articulations, sidechain, swells, stop-down), harmonic grid with melody snapping, pickups and bass approach notes between points
- [x] Electronic rebuilt on house/techno conventions (four on the floor, off-beat hats, clap on 2 and 4, sidechain, 4-bar riser and snare-roll build)
- [x] New styles: Orchestral epic and Movie score
- [x] Sampled instruments (smplr: soundfonts, Steinway, electric pianos, TR-808/LM-2/RZ-1, orchestral kit), selectable, with synthesized fallbacks
- [x] More neural networks: ImprovRNN (Improvise melody) and GrooVAE (Human groove)
- [x] Continuous regions: timbre, pan and loudness blended across focus point boundaries, metric accents, melody tied across points, point durations on the style's beat grid
- [x] Orchestration: Small / Medium / Full chosen from the analysis, Custom with Add layer; eight roles (counter-melody, ornaments, ostinato, section, doubling, drone, pulse, runs), each reading its own part of the image, with registers, density budget and entries over the arc
- [x] Four more styles with their genre rules: Lo-fi hip hop, Bossa nova, Synthwave, Classical; styles in a grouped dropdown with descriptions
- [x] Audit suite: every style × duration × orchestration × extreme settings on ordinary and edge-case images (exact timing, valid notes, notes in the scale, harmony on the grid, finite timbres, determinism, well-formed MIDI)
- [x] First-visit UX: Simple / Advanced (18 instead of 81 controls in Simple), Piece tab in cards, plain labels, why-it-sounds-like-this line, one download status, compact phone layout
- [x] Connections between points: passages read from the path between two points (edges crossed, brightness), Off / Light / Rich, and the Runs role
- [x] Role in the story per point (calm, build, climax, release) and accents
- [x] New song workflow: genre, duration, number of points and placement, then Generate song (automatic, plays) or Place the points myself
- [ ] Analysis at 384-512 px; forced connectivity in SLIC
- [x] Melody rhythm on a sixteenth-note grid (done in Phase 2a)
- [ ] Phrasing: focus points aligned to bars
- [ ] Global attention control (decision 3)
- [ ] Tests: golden determinism, continuity in radius and position, robustness to crops
- [ ] Formal `parameters.json` schema
- [ ] Scan path mode (The vOICe-style left-to-right sweep)
- [ ] Spectral texture layer (Photosounder / Virtual ANS-style additive synthesis)
- [x] Video export (MP4: image, animated path and effects, sound) in the image's shape, 16:9, 1:1 or 9:16 for Stories and Reels, with a live preview on the stage
- [x] Professional video: platform presets and safe areas, 1440p and 4K, quality levels, smoothed camera with easing curves, curved paths and 11 line styles, opacities for travelled and upcoming parts, labels on places (detected or your own), sound-reactive effects (beats, spectrum, waveform), colour grades, vignette, grain, fonts, end card, fades, saved looks; WebM, GIF and PNG poster exports
- [x] Harmony audit and voice-leading rules (avoid notes, suspensions, melody on top, restrikes); video cover; draggable text and more line, place and colour options
- [x] Pop, Rock, Metal, Blues and Funk with their genre rules (four-chord loop, power chords, palm-muted riffs, double bass drum, the 12-bar form with dominant sevenths and a boogie bass, a funk vamp with scratch guitar and ghost notes)
- [x] Audio export as WAV 16/24-bit, MP3 and M4A (AAC); Play waits for the neural models instead of starting by itself
- [ ] Optional perfect loop (reverb tail added over the start)
- [ ] Import of real eye-tracker focus points (x, y, duration)
- [ ] Python port on the same contract
