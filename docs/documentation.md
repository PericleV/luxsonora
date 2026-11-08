# Lux Sonora: technical documentation

Lux Sonora (formerly Sonification) turns a photograph into a piece of music, deterministically: the same image with the same settings always produces the same music. Unlike model-based music generators, every note, chord and timbre parameter can be traced back to a concrete area of the image.

The app runs entirely in the browser, with no server. The sources are ES modules in `src/`, and the build produces a single static file, `dist/index.html`, which runs on GitHub Pages, as a claude.ai artifact or straight from disk. The original prototype is kept in `legacy/sonificare.html`.

Terminology: a **focus point** is a place where the simulated eye stops (called a fixation in eye-tracking literature). The sequence of focus points is the **gaze path**.

---

## 1. Core idea

An image is spatial, music is temporal. The bridge between them is the **gaze path**: a sequence of focus points that imitates the order in which a person would look at the image. Each focus point becomes a musical fragment, and the area it lands on decides:

- which notes are played and for how long;
- which chord supports them;
- the rhythm of the percussion;
- **how the instruments sound** (envelope, filter, resonance, waveform colour).

The full pipeline:

```
image
  → analysis (colour, edges, entropy, texture, regions)
  → saliency map
  → gaze path (focus points)
  → musical representation (key, mode, fixed duration, motifs, layers, timbre)
  → sound (Web Audio, synthesized instruments) and export (MIDI, WAV, JSON)
```

---

## 2. Image ingest and analysis source

### 2.1 Loading

Files are identified by their first bytes, not by their declared type (TIFF files often arrive without one). Supported: PNG, JPEG, WebP, GIF, BMP, AVIF and TIFF/BigTIFF; HEIC where the browser decodes it. Decoding runs in a Web Worker so the interface stays responsive, with a progress bar and a Cancel button. Pages served from an opaque origin (a `data:` URL, some sandboxes) refuse inline workers; the worker announces itself with a handshake, and if none arrives within 1.5 s decoding falls back to the main thread, yielding between tiles.

- **Browser formats** are decoded by the browser and read back in tiles of at most 2048 × 2048 px, so no canvas ever exceeds Safari's limits (16.7 MP on older iOS, 67 MP from iOS 18).
- **TIFF** is decoded with geotiff.js (MIT) in horizontal bands of about 8 million samples, so memory stays proportional to one band. Supported: 8, 16 and 32-bit integer and floating-point samples, WhiteIsZero/BlackIsZero greyscale, RGB, palette, CMYK, YCbCr and CIELab, strips or tiles, no compression, LZW, Deflate, PackBits and JPEG. LERC and Zstandard are not bundled (they are WebAssembly decoders of several hundred kB and rare outside GIS). Multi-page files use the first page; stacks are out of scope.
- **Size limits**: images up to 300 MP on desktop (40 MP warning, 60 MP limit on phones and devices reporting 4 GB of memory or less). Header sizes are read before decoding, so oversized images are refused before they use memory.

### 2.2 Working image

Right after decoding, the image is reduced by **exact area averaging** to a working copy with a long side of at most 2048 px; the full-resolution pixels are then discarded. Each source pixel contributes to the target cells it overlaps in proportion to the overlapping area (separable box filter, fed tile by tile; the result does not depend on the tiling).

- **Photos** (browser formats, RGB TIFF) are averaged in **linear light**: values are linearized with the sRGB transfer curve first. Averaging fine black and white stripes gives 50% linear light, shown as 188, not the 127 that averaging encoded values would give.
- **Measurement data** (single-channel TIFF: SEM, TEM, detector images) is averaged in **raw units** (counts), which are already linear. NaN samples count as 0.

Transparent pixels are composited over black, the stage colour.

Before this change the browser's default "low" quality downscale was used: on fine stripes it gave a mean of 111 instead of 127.5 (13% error).

### 2.3 Analysis source

The working copy is turned into the displayed image and the analysed image by these steps, applied after resampling:

1. **Normalize**: photos are already linear 0-1; data uses an intensity range: *Full* bit depth (default for 8-bit data), *Percentile* 0.5-99.5% (default for 16-bit, 32-bit and float data), *Min-max*, all computed on the cropped working copy (4096-bin histogram).
2. **Channels**: Colour, Greyscale (Rec. 709 luminance, in linear light for photos) or a Custom mix of R, G, B weights.
3. **Encode**: photos get the sRGB curve; data is shown as measured (no extra curve).
4. **Invert**, then **contrast and brightness** `e → (e − ½)·(1 + contrast) + ½ + brightness/2`, then **gamma** `e → e^(1/γ)`.
5. **Crop** by fractions of each side, for example to remove the data bar under an SEM image.

The analysed image is the cropped working copy area-averaged to 200 px on its long side and processed the same way; the stage shows exactly what the analysis sees.

## 3. Image analysis

The analysed image has at most 200 px on its long side (see §2.3).

### 3.1 Per pixel

- **Luminance** (Rec. 709): `0.2126·R + 0.7152·G + 0.0722·B`.
- **HSV** for hue and saturation.
- **CIE Lab** (D65), used for segmentation and colour contrast.
- **Sobel edges** on luminance: magnitude and orientation. A pixel is an edge if its magnitude exceeds `max(0.06, mean + 0.8·standard deviation)`. The 95th percentile of the magnitude is used for normalization.

### 3.2 Regions (SLIC superpixels)

- K = 64 target superpixels, compactness m = 12, 8 iterations, distance in Lab + spatial space.
- Regions smaller than 20% of the average size are absorbed by their neighbours.

For each region:

| Feature | How it is computed |
|---|---|
| Area, centre | fraction of the image, centroid normalized to 0-1 |
| Brightness, variance | mean and variance of luminance |
| Lab colour | region mean |
| Saturation | mean HSV saturation |
| Hue | circular mean weighted by saturation |
| Warmth | mean of (R − B) |
| Edge density | fraction of edge pixels |
| Edge sharpness | mean edge magnitude / p95 / 1.5 |
| Entropy | Shannon entropy of the 16-bin luminance histogram, normalized |
| Orientation | 4-bin histogram of gradient orientation, weighted by magnitude |

### 3.3 Global features

| Feature | Formula |
|---|---|
| Brightness | mean luminance |
| Warmth | `0.5 + 1.5·mean(R − B)`, clamped to 0-1 |
| Saturation | mean saturation |
| Dominant hue | circular mean weighted by saturation, plus its strength |
| Entropy | 32-bin histogram, normalized to 0-1 |
| Edge density | fraction of edge pixels; the normalized version divides by 0.25 |

---

## 4. Saliency map

Saliency is computed per region, then projected onto pixels.

1. **Colour contrast** (region-contrast style): for each region i, the sum over the other regions j of `area_j · exp(−d²/0.18) · ‖Lab_i − Lab_j‖ / 100`, where d is the distance between centres. Nearby regions count more.
2. **Texture**: the region's edge density, normalized.
3. **Centre prior**: `exp(−dist² / (2·0.28²))` from the image centre.
4. **Semantic objects** (optional): regions whose centre falls inside an object's box receive that object's importance.

Combination:

```
base = (w_colour·contrast + w_texture·edges) / (w_colour + w_texture)
saliency = base · (0.55 + 0.45·centre_prior) + w_semantic · object · 0.8
```

The pixel map is smoothed with a box blur applied 3 times. Finally, a border attenuation (smoothstep over 10% of the short side, minimum 0.15) keeps the gaze from sticking to the image edges.

---

## 5. Focus points and the gaze path

### 5.1 Generation

The automatic path uses the winner-take-all plus inhibition-of-return mechanism of the Itti-Koch model, fully deterministic (the saliency map itself is region-contrast based, not the Itti-Koch feature pyramid):

1. Pick the pixel with the highest value in the map. Ties go to the first pixel in scan order.
2. **Minimum distance.** If the winner is closer than 60% of the inhibition radius to an existing focus point, it is a **revisit**: it reuses that point exactly (same position and area) instead of creating a new point next to it. Otherwise a new focus point is recorded (position, saliency, default radius).
3. **Inhibition of return**: multiply the map by `1 − exp(−d² / 2r²)` around the chosen point, with `r = Inhibition radius · image diagonal`.
4. **Memory**: the map partially recovers toward the original, `S += memory · (S₀ − S)`. This is what produces revisits.
5. Repeat until the requested number of **distinct places** (Focus points) is reached. **Returns** caps the number of revisits: a revisit beyond the cap is not recorded, the area is inhibited again and the search goes on. If the inhibited map drops below 7% of its initial maximum (or keeps offering refused revisits) before enough places are found, the next place is the most salient pixel of the original map that keeps the minimum distance to every place so far. The path is shorter than requested only when no such pixel is left. Once every place is found, the gaze keeps moving only to make the remaining returns (new places are skipped), so with Memory above 0 the number of returns usually reaches the Returns value; with Memory at 0 there are none.

The piece therefore has `places + returns` segments; the Returns control shows the actual numbers.

The **Variation** control applies deterministic multiplicative noise (0.88-1.12) over the map, with a fixed seed.

### 5.2 Footprint

Each focus point reads a **Gaussian footprint** with σ = r/2, where r is its radius as a fraction of the image diagonal; the circle drawn on the stage at radius r holds about 86% of the weight. The footprint weights are summed per SLIC region and the area features are the weighted average of the region features (hue as a saturation-weighted circular mean). Features therefore vary continuously with position and radius instead of jumping at region borders. The motif family of a point is the family with the largest footprint weight.

### 5.3 Weight

Each point has a **weight** w ∈ [0, 1], by default the saliency at its position. It sets the share of time (`W = 1 + 3w`, §7.2) and the loudness (`velocity = 52 + 68w`).

### 5.4 Coverage

The coverage map is `C = 1 − Π(1 − g_i)`, with g_i the peak-normalized footprint of point i (revisits counted once). The **background** is `1 − C`: what was not looked at. Its region-weighted features give the pad its timbre and its mean gives the pad its volume. The Coverage view on the stage shows C.

### 5.5 Editing

| Mode | Behaviour |
|---|---|
| **Auto** | The path is generated. Focus points sets how many distinct places, Returns how many revisits at most. |
| **Manual** | The path is a list owned by the user. The first edit of an automatic path switches to Manual and copies every current point. |
| **Mixed** | Points placed or edited by the user are anchors at their position in the sequence; the generator applies inhibition around them (radius max(inhibition, anchor radius)) and fills the other slots. |

On the stage: drag a point to move it, drag its white handle (or Alt + scroll) to resize it, click it to select and hear it. **Add point** (A) adds a point after the selected one. **Delete** removes the selected point (in Mixed mode, deleting an automatic point switches to Manual so it does not come back). The Focus point tab has Radius and Weight sliders and moves a point earlier or later in the path. Undo and redo (Ctrl+Z, Ctrl+Shift+Z) cover every edit.

**Role in the story.** The Focus point tab gives each point a role: *Auto* (the computed arc, §7.10), *Calm*, *Build*, *Climax* or *Release*, and an *Accent* switch. Only one point can be the climax. The roles override the arc at any Build-up amount; an accent puts a crash (or a low tom in styles without cymbals) and a kick on the point's first beat. Roles and accents are saved with the path in recipes.

### 5.6 Recipes

A **recipe** (`*.sonification.json`, Recipe menu: *Save recipe*; also inside the export archive) holds everything needed to make the same piece again:

- the **image**: the original file embedded (up to 25 MB), or the demo's name; larger images keep only the hash of the working copy;
- every **setting** and the **gaze path** (mode and points);
- the **versions**: the app's version and the URLs of the models used;
- the **instruments** of each layer (name, type, sample source) and the drum kit;
- the **neural results** that were applied: the Story or Improvise melody, the GrooVAE groove, the attention map of a neural placement (8-bit). They are used as they are when the recipe is opened, so the rebuild does not depend on the graphics card, the network or a model's availability;
- a **check**: a hash of the score (every note's layer, time, length, pitch and velocity), with the key, mode, tempo and note count.

Saving waits until running models have finished, so the recipe describes the finished piece. **Open recipe** loads the image, the settings, the path and the neural results, rebuilds the piece and reports *identical* or how it differs (including the version it was made with). Older project files (settings and path, no image) still open: the points are placed by position on the current image, with a warning when its hash differs.

### 5.7 Placement methods

**Placement** (Piece tab) chooses the attention map whose maxima the gaze generator picks (§5.1). Every map is computed on the analysed image (≤ 200 px), normalized to 0-1, and shown by the **Attention** view of the stage (`src/core/placement.js`, `src/ml/vision.js`).

| Method | Map |
|---|---|
| Region contrast | the original map (§4): colour contrast between regions, texture, centre prior |
| Spectral residual | Hou and Zhang (2007): on a 64×64 luminance, the log amplitude spectrum minus its circular 3×3 mean (with a floor of 2% of the strongest non-DC amplitude, so a small object's spectral zeros don't ring), back with the original phase, squared and smoothed: what stands out from the image's own statistics |
| Frequency-tuned | Achanta et al. (2009): distance of the slightly blurred CIE Lab image from its mean colour: whole objects |
| Itti-Koch | centre-surround differences (two centre and two surround scales) of intensity, red-green and blue-yellow opponency and four orientations, each normalized to favour maps with few strong peaks, summed |
| Details | difference-of-Gaussians blobs at three scales plus Harris corners, no centre prior and a light border fade: particles and structures in SEM, TEM and microscopy |
| Composition | rule-of-thirds intersections and the horizon (the row with the strongest horizontal edges in the middle 70%), weighted by region contrast so the points land on something |
| Scan | not a map: one point per column band, left to right, at the height where region contrast is highest (The vOICe-style sweep) |
| Objects (neural) | COCO-SSD (SSDLite MobileNet v2, 80 classes, about 5 MB): a Gaussian over each detection (score ≥ 0.35, non-maximum suppression), people centred toward the head; 75% objects plus 25% region contrast. Detected objects colour the timbre by category (living, natural, artificial, §8.4) when Claude's analysis is not used |
| Learned saliency (neural) | MSI-Net (Kroner et al. 2020, MIT), trained on eye-tracking data, at 160×120 input (about 25 MB) |

Neural maps are downloaded when first chosen (region contrast is used until they are ready), computed once per analysed image, quantized to 8 bits and stored in the recipe.

## 6. Motif families

Regions are grouped into 6 families with **k-means** on a 7-dimensional vector:

```
[brightness, saturation, cos(hue)·saturation, sin(hue)·saturation,
 2·edge density, entropy, 2·luminance standard deviation]
```

Initialization is deterministic: start from the largest region, then repeatedly add the farthest region. Then 12 iterations with area-weighted centroids.

Each family (A, B, C…) gets a motif:

- **Number of notes** (1-4) grows with texture: `1 + round(clamp(1.2·edges + 0.6·entropy)·3)`.
- **Contour** comes from the dominant edge orientation:

  | Orientation bin | Contour (scale steps) |
  |---|---|
  | 0 | `[0, 2, 4, 2]` (arpeggio) |
  | 1 | `[0, 1, 2, 4]` (rise) |
  | 2 | `[0, 1, 0, −1]` (calm neighbour tone) |
  | 3 | `[0, −1, −2, 1]` (descent) |

- **Rhythm** (duration weights) comes from brightness: bright areas `[2,1,1,2]`, dark areas `[1,1,1,1]`, mid areas `[3,1,2,2]`.

When the gaze returns to a family already visited, its motif comes back varied, in a cycle: **original → repeated → inverted → retrograde → repeated…** The image's self-similarity becomes the form of the piece.

---

## 7. Musical mapping

### 7.1 Global parameters

| Result | Computed from |
|---|---|
| Valence | `0.5·brightness + 0.3·warmth + 0.2·saturation` |
| Energy | `0.6·edge density + 0.4·entropy` |
| Mode | valence picks among the style's allowed modes, ordered from dark to bright: Phrygian, Aeolian, Dorian, Mixolydian, Ionian, Lydian. Can be set by hand, including major and minor pentatonic |
| Key | dominant hue read on the circle of fifths: `((round(hue/30) mod 12)·7) mod 12`. If the image is nearly colourless, the key comes from brightness. Can be set by hand |
| Style tempo | interpolation within the style's range by energy, multiplied by `1 + tempo adjustment` |

With semantic analysis, the valence and energy read by Claude are blended in at `0.6 · Semantic control`.

### 7.2 Fixed duration and time split

The piece has a fixed duration T (15, 30 or 60 s; default 30 s) in 4/4.

1. **Whole bars.** `bars = max(3, round(T · bpm_style / 240))`, then `bpm = bars · 240 / T`. The piece lasts exactly T seconds. The tempo correction is at most `120 / T` BPM (±4 BPM at 30 s, ±8 at 15 s, ±2 at 60 s). At T = 30 s the resulting tempo is always a multiple of 8 BPM.
2. **Cadence.** The last bar (4 beats) is reserved for the cadence. The body has `B = 4·bars − 4` beats.
3. **Number of focus points.** Each one gets at least one beat, so at most B are used. If the path has more, the first B are kept and the interface says so.
4. **Weight.** `W_i = 1 + 3·w_i`, where w_i is the point's weight (§5.3). The maximum ratio between two points is 1:4.
5. **Ideal duration** is proportional to the weight: `d_i = B · W_i / ΣW`. Points that would get less than one beat are pinned to one beat and the rest is redistributed among the others (water-filling).
6. **Exact rounding.** Durations are rounded to the style's grid (whole beats, or two beats for Electronic and Orchestral epic; half beats when called without a style) with the largest-remainder (Hamilton) method: each point gets its integer part and the leftover units go to the largest remainders. The sum is exactly B, and each duration is within half a beat of its ideal value.

Each point's share of the piece, `d_i / (4·bars)`, is shown in the Focus point tab.

### 7.3 Melody (from the gaze path)

- **Target step** comes from the vertical position: `round((1 − y)·R·n) − round(0.2·R·n)`, where n is the number of notes in the scale and R the melodic range in octaves (default 2). Up means higher. The melody octave control shifts the whole melody by whole octaves.
- **Saccade step**: the direction comes from vertical movement (or horizontal, if the saccade is nearly flat). The size is `max(1, round(length · n · 1.4))`. A long saccade means a leap.
- **Fidelity** blends the two: `step = lerp(previous_step + saccade_step, target_step, fidelity)`. Fidelity does not affect duration.
- **Motif rhythm** is spread over the point's duration: boundaries between notes are rounded to the sixteenth-note grid, with at least one sixteenth per note. The melody always lands on the grid (except for the Jazz swing).
- **Velocity**: `52 + 68·weight`.
- **Stereo pan**: `(x − 0.5)·0.9`, clamped to ±0.5, blended between points (§7.7).
- The Minimal style uses the major or minor pentatonic as a subset of the chosen mode.

### 7.3a Story melody (Magenta MusicVAE)

The **Melody** control in the Piece tab chooses between **Classic** (§7.3) and **Story**. Story reads the gaze path as a story with Magenta's MusicVAE `mel_chords` model (two-bar melodies conditioned on one triad per sixteenth step, latent size 128). The model, about 18 MB, is downloaded from Magenta's public storage the first time Story is chosen (decision 22); until it is ready, and whenever it can't load, the classic melody plays.

1. **Themes.** Every distinct place gets a theme: its classic notes (so its height still sets the register) repeated over two bars. The model encodes each theme into a latent vector z. A return to a place reuses the same z, so the theme comes back.
2. **The path is the story.** Segment i is decoded from `slerp(z_i, z_next, u)`, a point between its own place and the next one. The lean `u = 0.2 + 0.45·min(1, saccade / 0.6)` grows with the length of the saccade, so every segment already leans toward where the eye goes next: changing the order of the points changes the melody, not only its sequence. A segment longer than two bars is decoded in several windows that move further toward the next place.
3. **Harmony.** The decoder is conditioned on the chords of §7.4, as triads: the segment's chord on its own steps, the next segment's chord on the steps after it. The melody therefore fits the harmony the image chose.
4. **Register.** Each decoded segment is moved by whole octaves so its mean pitch matches the classic melody of that point.
5. **Phrasing.** A note restruck at the same pitch right after itself (within half a beat) becomes one held note, and rests shorter than half a beat are filled by the note before them, also up to the end of the segment; longer rests remain as breaths.
6. **Notes** keep the point's velocity, timbre, pan and glide; the cadence note moves to the tonic closest to the last story note.
7. **Instrument.** A plucked string would cut the long, tied line into separate attacks, so with Story each style's default melody instrument is a sustained lead: Soft lead (Ambient, Cinematic), Warm lead (Minimal, Jazz), Synth lead (Electronic). A preset chosen in the Sound tab still wins.

Decoding takes the most likely note at each step (no sampling), so the same image and settings give the same melody; on the test machine WebGL and CPU produced identical notes. TensorFlow.js uses WebGL when available (about 0.2 s per segment) and the CPU otherwise (about 2 s per segment). Results are cached per path for the session. `parameters.json` records which melody was used.

### 7.3b Improvise melody (Magenta ImprovRNN)

**Melody: Improvise** uses Magenta's ImprovRNN (`chord_pitches_improv`, about 6 MB, downloaded when first chosen), an LSTM trained on lead sheets that continues a melody over given chords (`src/ml/improv.js`). For each focus point it continues a seed made of the last beat it has just played (so the line carries across points) followed by the point's own theme (its classic notes in two beats, folded into the model's range MIDI 48-83). The chords come per sixteenth step from the harmonic grid (§9.1). The output is phrased (repeated notes held, short rests filled), moved by octaves to the point's register and applied like the story melody; decoding takes the most likely note at every step (no sampling), so it is deterministic. The default melody instrument is the same sustained lead as for Story.

### 7.3c Human groove (Magenta GrooVAE)

**Groove: Human** plays the drum part through Magenta's GrooVAE (`groovae_2bar_humanize`, downloaded when first chosen; `src/ml/groove.js`), a model trained on drummers' performances that turns a quantized pattern into a played one. The drums are given in two-bar windows (one batch); every hit keeps its place and its focus point, and from the model's performance of the same drum on the same step it takes the timing offset (at most 0.4 of a sixteenth) and the velocity, blended per style: jazz 85% of the timing and 70% of the velocity, ambient and cinematic about half, minimal and epic about a third, and **electronic music keeps its timing on the grid** (a drum machine) and takes only the accents (45%). Decoding is deterministic.

### 7.4 Harmony

- **Bright areas** (L > 0.5) choose among I, IV, V. **Dark areas** choose among vi, ii, iii.
- Among the candidates, the chord in which the first melody note is a chord tone wins.
- **The seventh** is added if the style asks for it or if the region's entropy exceeds 0.78. **The ninth** appears if the style asks for it or if entropy exceeds 0.9.
- **Simple voice leading**: each chord tone moves to the octave closest to the centre of the previous chord (±7 semitones).
- **With smooth transitions on**, the chord is chosen among the candidates that hold the melody note (all candidates if none does) as the one sharing the most pitch classes with the previous chord; ties keep the order above.
- **How the harmony plays** (`src/core/patterns.js`) is chosen per point from the area, read relative to the image (the modulation vector of §8.2), and from the dramatic arc (§7.10): a **held chord** in smooth areas, quiet moments, the introduction and the resolution; an **arpeggio** in complex areas and at the climax (up, or down when the dominant edge orientation is the third or fourth bin; sixteenths above tension 0.78, otherwise eighths); a **pulsing chord** on a euclidean rhythm E(3-8, 16) in rough areas; a **broken chord** (low, high, middle, high in eighths) otherwise. Every note is a chord tone and stays inside its point.

### 7.5 Bass

The bass plays the chord root in the MIDI range 33-47. The style gives its kind; the area and the arc vary it:

| Style kind | Variants |
|---|---|
| hold | root and fifth in half notes at tension above 0.65 in rough areas; held root in the resolution |
| pulse | subdivision from the area's texture (eighths, quarters or halves); octave eighths at tension above 0.7 in complex areas |
| walk | quarters on steps 0, 2, 4, 5 above the root; two-feel (root and fifth in half notes) below tension 0.45 and in the resolution |

With the arc on, the bass is silent in the introduction and enters after it.

### 7.6 Rhythm

Each style has a drum kit (`src/core/rhythm.js`, General MIDI numbers on channel 10), and each focus point gets its own one-bar pattern on the absolute sixteenth grid, so the groove stays in time across points while the pattern changes:

| Style | Kit | Pattern |
|---|---|---|
| Ambient | shaker, rim, low tom, soft kick | shaker E(2-10), rim E(1-4), toms and kick enter with tension |
| Cinematic | toms, kick, snare, shaker, crash | tom ostinato E(2-7) (low then mid tom), kick on 1 (and 3), snare on 4, crash at the climax |
| Minimal | closed hi-hat, rim, kick, clap | hats E(3-12), rims E(2-5), kicks E(1-4), clap on 4 |
| Jazz | ride, pedal hi-hat, snare ghosts, kick | ride on the beats plus the swung skip notes, pedal hi-hat on 2 and 4, comping ghost snares E(1-5), feathered kick |
| Electronic | kick, clap, hi-hats, rim, crash | four on the floor (half time at low tension), clap on 2 and 4, hats E(4-14), open hi-hats on the off-beats at high tension |

E(k) is a euclidean rhythm: k onsets spread as evenly as possible over 16 steps. The number of onsets comes from the area (texture: roughness and entropy; sharpness for rims and clicks; saturation for open hi-hats), always relative to the image, and from the tension; the rotation comes from the dominant edge orientation and the horizontal position, so different places get different grooves. Accents fall on the beats (eighths ×0.85, sixteenths ×0.72) and luminance variance adds up to 30%. A level per style (velocity scale 88-104) keeps the kit 3.5-8 dB below the full mix in RMS on the demos (Electronic about 2 dB, as the genre expects).

- **Introduction**: only texture voices (shaker, hats, rim, ride). **Resolution**: no snare, clap, toms or open hats.
- **Fills**: the last beat of a point becomes a fill (toms, a snare roll in Jazz, rim clicks in Minimal) before the climax and before the longest saccades of the path (the top quarter, at least 0.35), never on two points in a row, if the point lasts two beats or more.
- **Cadence**: one closing hit per style (low tom; kick and crash; kick; ride and kick; kick and crash).

### 7.7 Smooth transitions

One control, **Smooth transitions** s ∈ [0, 1] (default 0.6), shapes every change between consecutive focus points. At 0 it is off and the piece is exactly as without it.

| Aspect | Rule |
|---|---|
| Melodic leap | the leap from the last note of a point to the first note of the next is limited to `round(12 − 7s)` semitones (5 at s = 1) by moving the new motif by whole octaves toward the previous note, only within the melody register (one octave below the base to R octaves above); if the register does not allow it, the leap stays |
| Chords | common-tone choice described in §7.4 |
| Dynamics | velocity changes by at most `68 − 56s` between points |
| Continuous regions | each point's values (melody, harmony and bass timbre; pan; melody loudness) hold at its centre; around a boundary the notes take values blended by their time with a smoothstep, over a zone `s ·` the shorter of the two points wide (centre to centre at s = 1). Times and frequencies blend on a log scale, so a sampled instrument's cutoff also moves note by note (`src/core/compose.js`, `applyContours`) |
| Accents | the melody's accents follow the bar (downbeat 1.0, beats 0.92, the rest 0.82), not the start of each point |
| Ties | a rest shorter than half a beat between the last note of a point and the first of the next is filled, so the melody is legato across the boundary (classic, Story and Improvise) |

Why it matters: measured on the Lake sunset demo before this change, every boundary changed the melody's loudness by 22-24 velocity steps on average (52 at most), its stereo position by 0.62 (1.13 at most), its brightness by 0.3-0.6 octave (1.3 at most) and its release by up to ×2, with a 0.04-0.3 beat silence and a fresh accented motif, often on a half beat. Each change is small; all at once they sound like a cut.

Point durations are rounded to the style's grid (`RULES.grid`): whole beats, two beats for Electronic and Orchestral epic, so a point (and its melodic phrase) never starts on a half beat. The stereo position of the melody is `(x − 0.5)·0.9`, within ±0.5.

### 7.7a Connections between points

**Connections** (Piece tab: Off, Light, Rich; default Light) add a short passage at the end of each focus point that leads into the next (`src/core/passages.js`). The line from one point to the next (the saccade) is read on the analysed image like the points themselves: 64 samples of brightness, edge strength and region labels.

| | Rule |
|---|---|
| Edges crossed | local maxima of `mag / p95` ≥ 0.6, at least 8% of the line apart, between 10% and 90% of it |
| Window | the last beat of the point (two in Rich), never more than the point minus half a beat |
| Number of notes | Light: 1-2 (the edges crossed), only for a jump ≥ 25% of the diagonal or 3 semitones; Rich: `min(6, 1 + edges + round(4·length))` |
| Times | on the edges crossed, on a sixteenth grid (eighths in Ambient and Movie score); without edges, at the end of the window |
| Pitch | the straight line from the last note to the arrival note, plus the brightness along the path relative to that line × 7 semitones, then the nearest chord tone (on a beat) or scale tone (off the beat) |
| Arrival | the last note is a scale step next to the next point's first note (a chromatic semitone in Jazz); no note repeats its neighbour |
| Style | Electronic and Synthwave arpeggiate the next chord |

The passage replaces the notes the point would play in that window (and the older pickups); its velocity is 72-92% of the last note, rising toward the arrival. Off leaves the piece exactly as without it. On the stage the passage notes appear as dots along the path, and the *why* line says how many edges the path crosses. The **Runs** role (§7.11) uses the same profile for a second voice.

(A real eye sees very little during a saccade; this is an artistic reading of the path.)

### 7.7b Harmony rules and the music audit

Every piece goes through the same voice-leading rules after it is composed (and again after a neural melody is applied, `fitMelody` and `cleanVoices` in `src/core/compose.js`):

| Rule | What it does |
|---|---|
| Melody on the chord | a melody note on a beat, or held almost a beat, that is not in the chord moves to the nearest chord tone of the melody's scale within a minor third |
| Avoid notes | a melody note outside the chord a semitone from one of its tones (the harshest rub), held half a beat or more, moves to a chord tone, or to a tension a whole step from the chord (a ninth, a sixth). It stays when it resolves by step into a chord tone right after (an appoggiatura or a passing note), unless it is longer than half a beat and a semitone from the chord's root (a minor ninth). The check runs again after the ties and the legato have lengthened the notes |
| Suspensions resolve | a long melody note held into a chord it rubs against is held until the change and then moves by step to the nearest tone of the new chord |
| Passages | the last note of a connection approaches the next point by a scale step from the side that does not rub against the chord there; if both sides rub, from a chord tone within a third |
| Runs | the Runs layer lands on its arrival note, a chord tone on the next point's first beat |
| Walking bass | beat 4 of each bar leads into the next downbeat by a semitone (from below, then above), instead of a sixth that would rub against a seventh chord |
| Melody on top | a harmony note (or a held section chord) above the melody moves down an octave while it stays at or above MIDI 48; a voice still covering the melody is left out when its chord keeps others below it |
| No restrikes | a note that starts while the same pitch sounds in its layer ends the earlier one; in single-line layers (melody, bass, counter-melody, runs, doubling, ostinato, pulse, ornaments) at any pitch |
| No stale notes | an accompaniment note held into a chord it rubs against ends at the change (the drone keeps its pedal) |

`scripts/music-audit.mjs` measures, note by note, what can still sound wrong, on 25 pieces per style (5 images × 5 settings), per minute of music: exposed clashes (two notes a semitone or a minor ninth apart in different layers, one of them outside the chord, on a beat or held half a beat, not resolving by step), notes outside the harmony's scale, accompaniment notes outside the chord on a beat, melody notes rubbing against the chord on a beat, unresolved notes, wrong bass notes on a chord change (pedal points allowed), the melody under the harmony, restrikes, leaps over an octave, drum hits off the grid (swing excepted), pile-ups, the range and the ending. `test/harmony.test.js` keeps the main ones under limits. Measured in November 2026, before and after these rules (exposed clashes per minute):

| Style | Before | After |
|---|---|---|
| Classical | 36.6 | 2.6 |
| Cinematic | 29.7 | 2.7 |
| Orchestral epic | 28.9 | 0.8 |
| Movie score | 19.8 | 0.3 |
| Ambient | 19.6 | 1.2 |
| Synthwave | 17.8 | 0.5 |
| Jazz | 15.6 | 0.2 |
| Bossa nova | 10.5 | 0.6 |
| Minimal | 9.3 | 3.0 |
| Electronic | 6.3 | 0.4 |
| Lo-fi hip hop | 4.4 | 0.5 |

Accompaniment notes outside the chord, restrikes and notes outside the scale are at or near zero in every style; the melody under the harmony dropped two to four times (it remains in arpeggiated accompaniments, where a single voice plays at a time).

### 7.8 Cadence

The last bar plays the tonic chord (with a seventh if the style uses sevenths), the bass on the tonic and, in the melody, the tonic closest to the last note played. The instruments play unmodulated here (the style's base timbre). Each note is shortened so that its release (`1.6·r`) ends before T, but never below one beat. Styles with a kick mark the start of the cadence.

### 7.9 Background pad

- The background is what was not looked at, `1 − coverage` (§5.4), the "periphery of vision".
- **The pad follows the harmony.** Three voices play the triad of each focus point's chord (§7.4). At each boundary they move to the next triad by the smallest total motion (each voice takes the nearest octave of a chord tone; of the six assignments the one with the least movement wins), within MIDI 45-74. On the cadence they move to the tonic triad.
- **Common tones are held, not restruck.** A voice whose note stays the same keeps sounding across the boundary; its filter glides (time constant 0.35 beat) to the timbre of the new point. Only the voices that change are restruck, so the pad breathes with the path instead of pulsing in blocks.
- **Its timbre evolves with the path.** Each new pad note takes the timbre of the background *around* the current point (the periphery of vision there): region features weighted by a wide Gaussian around the point (σ = 2.5·r of the diagonal, at least 10%) times `1 − C`, modulated at 60% depth like the rest of §8. The cadence uses the background of the whole image.
- **Volume**: `30 + 50·min(1, 1.4·b)`, with b the mean of the image background and the local background share around the point.
- Without coverage data (the legacy path) the pad keeps the old form: tonic and fifth (plus the ninth on bright images) in two-bar blocks.

### 7.10 Dramatic arc

The **Dramatic arc** control (0-100%, default 70%) reads the gaze path as a story in four sections: **introduction, development, climax, resolution** (`src/core/arc.js`).

- **Climax**: the segment whose centre lies between 50% and 85% of the body and scores highest on weight + 0.5·min(1, saccade / 0.5) + 0.2 for a new place: the most striking new place of the second half.
- **Tension** of each segment: `D = lerp(0.6, 0.7·template + 0.3·local, amount)`, with the template rising from 0.25 to 1 at the climax and falling to 0.35 at the cadence, and `local = 0.5·weight + 0.5·min(1, saccade / 0.5)`, minus 0.15 for a return (recognition is a release). The climax has D = 1 before blending.
- **Sections**: the introduction is the first 15% of the body (at least the first segment, with four or more points); everything after the climax is the resolution. Below 25% the sections are off and every segment is development.

What follows the tension and the sections:

| | Effect |
|---|---|
| Dynamics | every note's velocity × (0.82 + 0.3·D): 1.0 near the neutral tension |
| Drums | density of every pattern, the voices that enter, fills, the crash at the climax (§7.6) |
| Harmony and bass | articulation (§7.4, §7.5); the bass enters after the introduction |
| Pad | filter × 2^(0.8·(D − 0.6)), velocity × the dynamics |
| Melody | doubled an octave above at the climax (55% velocity), also with the story melody |

The timeline shows the tension as a band along the top of the ruler; the Focus point tab shows the section, the tension and what each layer plays.

### 7.11 Orchestration: extra layers

**Orchestration** (Piece tab) adds layers beyond melody, harmony, bass, pad and rhythm (`src/core/arrange.js`). **Small** adds none (the piece is exactly the five-layer one); **Medium** adds 2-3 and **Full** 4-6, more for richer images (`richness = 0.4·entropy + 0.3·edges + 0.3·min(1, places / 10)`), in the style's order of roles, each on the style's instrument for that role (sampled, or a synthesizer when sampled instruments are off). **Add layer** picks a role, a layer's instrument can be changed, and a layer can be removed; any change copies the list into **Custom**, which the user owns. Every role reads its own part of the image:

| Role | Reads | Plays |
|---|---|---|
| Counter-melody | a second gaze path on `attention × (1 − coverage)`: what the first path missed | chord tones below the melody (MIDI base −12 to +2), one per half bar (per beat when tense), moving toward the height of its point, never on the melody's pitch class at that moment |
| Ornaments | blobs and corners weighted by brightness (the strongest, at least 8% of the diagonal apart) | short high chord tones (base +12 to +26) on an off-beat of the focus point nearest each detail, at most two per point |
| Ostinato | the area's texture | root, fifth, octave, fifth in eighths (sixteenths when tense), from the development on |
| Section | the large calm regions | the slot's triad held and swelling, voice-led, in the middle register |
| Doubling | the melody | the melody an octave lower (higher below MIDI 48) at 70% velocity; recomputed after a neural melody |
| Drone | the background | tonic and fifth in two-bar blocks, low |
| Pulse | the edges | low pitched percussion (timpani, taiko) on a euclidean figure, root on the downbeat, the chord tone nearest a fifth above otherwise |
| Runs | the path between points (§7.7a) | a Rich passage in its own register (base to +19) at the end of each point, a scalar run that links the places |

Arrangement rules: notes come from the sounding chord (or the melody), so every layer stays in the scale; each role has its own register; with n extra layers each plays `1 / (1 + 0.22·(n − 1))` as densely; the k-th layer enters when the tension reaches `0.42 + 0.38·k / n`, so they join one by one toward the climax and leave in the resolution (the drone and the ornaments stay). In the cadence the sustained roles play the tonic chord. Extra layers take their timbre from the image like the harmony (50% depth, blended between regions), have their own channel (level per role, mute, solo, volume, EQ, drive, sends; sidechained in Electronic), their own MIDI track (channels 5-9 and 11-16, General MIDI program per role) and are saved in recipes.

---

## 8. Timbre: per-layer instrument, modulated by the image

### 8.1 Principle

Each layer has **its own instrument**, defined by the style (table in §9). The image **does not replace** the instrument, it shifts its parameters within fixed bounds. The melody stays recognizably the same voice, while the areas colour it differently.

### 8.2 Modulation vector

Five features are computed for the focus point's area: edge sharpness, smoothness (`1 − edges / max_edges`), entropy, saturation and warmth. Each is compared with the image itself:

```
z(x) = clamp((x − μ) / (2·max(σ, floor)), −1, 1)
```

μ and σ are the area-weighted mean and standard deviation over all regions of the image. An area at ±2σ from the mean reaches the modulation limit. The floors (0.02-0.05) prevent amplifying noise in uniform images. What you hear is **the contrast between areas**, not the absolute level; the global character of the image goes through mode, tempo and pad.

Each component has one main perceptual dimension:

| Component | Source | Effect (k = depth × control) |
|---|---|---|
| att | `−z(sharpness)` | attack × `2^(1.5·k·att)`: sharp edges → faster attack |
| leg | `+z(smoothness)` | decay and release × `2^(1.0·k·leg)`, sustain `+0.25·k·leg`: smooth area → more legato |
| bri | `+z(entropy)` | cutoff × `2^(1.5·k·bri)`: high entropy → brighter sound |
| res | `+z(saturation)` | Q × `2^(1.0·k·res)`, clamped to 0.3-12: saturated colours → more resonant |
| col | `+z(warmth)` | instrument colour parameter `+0.35·k·col`: warm tones → more harmonics |

Time and frequency parameters are modulated on a logarithmic scale (in octaves), because that is how they are perceived.

### 8.3 Depth per layer

| Layer | Depth | Source |
|---|---|---|
| Melody | 100% on all dimensions | focus point area |
| Harmony | 50% | focus point area |
| Bass | brightness only, 50% | focus point area |
| Pad | 60% | background average |
| Rhythm | no timbre modulation | edges only decide hit density |

The **Image timbre** control (0-100%) scales all depths. At 0% the instruments sound exactly as defined by the style.

### 8.4 Semantic objects

If a focus point lands on an object found by Claude, its category shifts the modulation vector by `0.5 · Semantic control` times this profile:

| Category | Shift |
|---|---|
| living | legato +0.4, colour +0.3 (a warm voice) |
| natural | attack +0.4, legato +0.5 (a soft sound) |
| artificial | attack −0.6, brightness +0.3, legato −0.3 (a percussive sound) |

---

## 9. Styles and instruments

| Style | Tempo | Allowed modes | Chord grid | Drum phrase | Kit (default) |
|---|---|---|---|---|---|
| Ambient | 56-82 | all six | 2 bars | 2 bars | synthesized: shaker, rim, soft toms |
| Cinematic | 62-96 | Aeolian, Dorian, Ionian, Lydian | 1 bar | 2 bars | orchestral: toms and taiko, snare, crash |
| Minimal | 84-118 | Aeolian, Dorian, Mixolydian, Ionian (pentatonic) | 2 bars | 4 bars | synthesized: hats, rims, kick |
| Jazz | 92-138 | Dorian, Mixolydian, Ionian, Lydian | 1 bar | 2 bars | synthesized: ride, pedal hi-hat, brushes, kick |
| Electronic | 104-126 | Phrygian, Aeolian, Dorian, Mixolydian | 1 bar | 4 bars | Roland TR-808 |
| Orchestral epic | 88-128 | Phrygian, Aeolian, Dorian | 1 bar | 2 bars | orchestral: taiko, timpani, snare, crash |
| Movie score | 60-88 | Aeolian, Dorian, Ionian, Lydian | 2 bars (1 bar when tense) | 2 bars | orchestral: timpani, cymbal swells |
| Lo-fi hip hop | 70-90 | Dorian, Aeolian, Mixolydian, Ionian | 1 bar | 4 bars | LinnDrum LM-2: boom bap |
| Bossa nova | 110-140 | Dorian, Ionian, Lydian, Mixolydian | 1 bar | 2 bars | synthesized: cross-stick on the clave, shaker, soft kick |
| Synthwave | 84-118 | Aeolian, Dorian, Phrygian | 1 bar | 4 bars | LinnDrum LM-2: big snare, eighth hats |
| Classical | 66-112 | Ionian, Aeolian | 1 bar | 4 bars | none |
| Pop | 96-124 | Ionian, Mixolydian, Aeolian, Dorian | 1 bar (a four-chord loop) | 4 bars | LinnDrum LM-2: kick, snare and clap, hats |
| Rock | 100-140 | Mixolydian, Aeolian, Dorian, Ionian | 1 bar | 4 bars | Linn 9000: kick, snare, hats or ride, crashes, toms |
| Metal | 120-168 | Phrygian, Aeolian | 1 bar | 2 bars | Oberheim DMX: double bass drum, snare, crashes |
| Blues | 72-104 | Mixolydian, with a blues melody scale (1 2 ♭3 3 5 6 ♭7) | 1 bar, the 12-bar form | 4 bars | Linn 9000: shuffle on the ride |
| Funk | 92-116 | Dorian, Mixolydian | 1 bar (a vamp) | 2 bars | LinnDrum LM-2: syncopated kick, ghost notes, sixteenth hats |

In the Piece tab the styles are a dropdown in four groups (Calm: Ambient, Minimal, Lo-fi hip hop, Classical; Film: Cinematic, Movie score, Orchestral epic; Groove: Jazz, Bossa nova, Electronic, Synthwave; Band: Pop, Rock, Metal, Blues, Funk), with a one-line description of the chosen style.

### 9.1 Genre rules

Each style keeps the conventions of its genre (`RULES` in `src/core/theory.js`); the image chooses inside them. Sources: lo-fi production guides (70-90 BPM, swung boom-bap drums, jazz sevenths and ninths on electric piano), bossa nova guitar and bass method material (the 3-2 bossa clave, root-fifth bass), synthwave production guides (80-118 BPM, gated snare, arpeggiated bass, minor keys), common-practice harmony (Alberti bass, authentic cadence V-I), house and techno production guides (four on the floor, clap on 2 and 4, off-beat hi-hats, sidechain, loops in 4 and 8 bars, fills and builds before a drop), epic trailer writing (string ostinatos, taiko percussion, brass "braams", choir, the trailer "stop-down"), film scoring (leitmotif, pedal point, sparse harmonic change for emotional continuity, sustained low notes for dread), and standard jazz practice (ride "spang-a-lang", hi-hat on 2 and 4, walking bass with approach notes, Charleston comping).

| Style | Harmony plays | Bass plays | Chords | Transitions |
|---|---|---|---|---|
| Ambient | held chords, slow arpeggios | tonic pedal, held roots | I IV V / vi ii iii | cymbal swells |
| Cinematic | held, broken, arpeggiated | held roots, root and fifth, approach notes | I IV V / vi ii iii | cymbal swells, tom fills |
| Minimal | broken chords and arpeggios only (ostinato) | repeated roots | I IV V / vi IV ii | rim fills, no swells |
| Jazz | held chords at rest, Charleston comping | two-feel, walking with a chromatic approach | I IV V / ii vi iii | snare fills, pickups |
| Electronic | pads at rest, off-beat stabs | held, off-beat eighths; sidechain pump on every kick | I vi IV / vi IV vii | 4-bar riser and snare-roll build into the drop |
| Orchestral epic | held chords, string ostinato in sixteenths | held, eighth-note ostinato | VI III VII / i iv VI | timpani roll, stop-down before the climax, crash |
| Movie score | swelling held strings, harp or piano arpeggios | tonic pedal, held roots, approach notes | I IV V / vi IV ii | cymbal swells, pickups |
| Lo-fi hip hop | electric piano chords (sevenths and ninths), comping | held roots, root and fifth; light sidechain | ii V I / vi IV ii | snare fills; off sixteenths swung late (behind the beat) |
| Bossa nova | nylon-guitar comping on the 3-2 bossa clave (beats 1, 2½, 4 \| 2, 3½) | root on 1, fifth on the "and" of 2 and on 3 | I ii V / ii V vi | rim fills, pickups |
| Synthwave | poly-synth chords, sixteenth arpeggios at the peak | octave eighths; light sidechain | VI III VII / i VI iv | riser into the climax, tom fills |
| Classical | block chords, then an Alberti left hand | held roots, root and fifth, approach notes | I IV V / vi ii V; the chord before the cadence is always V (V-I) | pickups; no drums |
| Pop | held chords, repeated chords on a euclidean figure, arpeggios; piano and clean guitar | held roots, picked eighths; light sidechain | the four-chord loop, one chord per bar: I V vi IV (major), i VI III VII (minor) | riser, snare and clap fills; kick on 1, 3 and the "and" of 3, snare and clap on 2 and 4 |
| Rock | power chords (root and fifth in E2-D♯3) struck on 1 and 3, then in eighths | picked eighths on the root | I IV V / vi IV V | crash at every new phrase, tom fills; kick pattern from the area, ride when driving |
| Metal | syncopated power-chord hits (1, the "and" of 2, 4), power chords in eighths, then a palm-muted sixteenth riff on a euclidean figure | picked eighths, then the guitar's riff in sixteenths | i VI VII / i iv VI (Phrygian, Aeolian) | stop-down before the climax; double bass drum at the peak, crashes on the beats; half-time in the resolution |
| Blues | held chords, Charleston comping (piano) | boogie line in swung eighths (root, 3, 5, 6, ♭7, 6, 5, 3) | the 12-bar form, every chord a dominant seventh: I7 I7 I7 I7 IV7 IV7 I7 I7 V7 IV7 I7 V7 | shuffle (swung eighths), snare fills |
| Funk | Charleston comping, then a "chicken scratch" guitar: short stabs of the top three voices on a syncopated sixteenth figure, muted ghost strums between | the root on 1, then octave, seventh and fifth on a syncopated sixteenth figure (in the scale) | a vamp: I I IV I (Mixolydian), i i IV IV (Dorian), ninth chords | swung sixteenths, ghost snares, open hat on the "and" of 4 |

- **Chord grid.** Chords change only on the style's grid (1 or 2 bars; two-bar styles move every bar above tension 0.8). Each slot of the grid takes the chord of the focus point that covers most of it; neighbours with the same chord merge. Harmony, bass and pad follow the slots.
- **Melody on the grid.** A melody note on a beat, or a long note, that is not in the sounding chord moves to the nearest chord tone of the melody scale (at most a whole tone).
- **Drum phrases.** The groove is a one-bar pattern that stays the same for a whole phrase (2 or 4 bars); the area under the focus point at the phrase start chooses its euclidean ornaments, the tension of each bar how many kit layers play.
- **Transitions between focus points and sections.** Pickup notes lead the classic melody into the next point (a scale step before its first note, on the last eighth), the bass approaches the next root on the last beat of a chord, fills close phrases that lead into a new section, and a swell (riser, reversed cymbal or timpani roll, by style) ends exactly where the new section begins. Orchestral epic stops everything for the half beat before the climax and comes back on it.
- **Distortion** (Rock, Metal): the synthesized guitars get the style's drive on the harmony and the melody (and a little on the metal bass), the larger of it and the mixer's; sampled guitars are already distorted and get none. Power chords are two voices (root and fifth): separately distorted notes stacked with the octave sound harsh. The pad plays lower under distorted guitars (70% in rock, 50% in metal), so it does not drone. Rock plays on a Linn 9000 kit, metal on an Oberheim DMX, pop on a LinnDrum.
- **Sidechain** (Electronic): harmony, bass and pad duck by 65% on every kick and recover over about a quarter beat, the pumping of house music.

### 9.2 Instruments

Synthesized base instruments per style (always available, and the fallback of every sampled instrument):

| Style | Melody | Harmony | Bass | Pad |
|---|---|---|---|---|
| Ambient | Soft pluck, T60 2.4 s | FM bell, ratio 2 | Round sub | Warm pad, 9 cents detune |
| Cinematic | Harp, T60 3.2 s | FM piano, ratio 1 | Deep bass | Strings, 70% sawtooth |
| Minimal | Short pluck, T60 0.9 s | FM marimba, ratio 4 | Pulse bass | Subtle pad |
| Jazz | Guitar, T60 1.6 s | Electric piano, ratio 1 | Upright bass | Soft organ |
| Electronic | Synth pluck, Q 3.5 | Saw chord stab | Synth bass | Wide pad, 18 cents detune |
| Orchestral epic | Horn section | String ostinato | Low strings | Choir |
| Movie score | Felt piano | Legato strings | Celli and basses | Soft strings |
| Lo-fi hip hop | Mellow keys | Dusty electric piano | Warm bass | Tape pad |
| Bossa nova | Nylon melody | Nylon comping | Upright bass | Soft strings |
| Synthwave | Saw lead | Poly synth | Octave bass | Analog pad |
| Classical | Piano (right hand) | Piano (left hand) | Cello | String quartet |

**Sampled instruments** (`src/audio/samples.js`, smplr, MIT) are on by default (Sound tab, Master: *Sampled instruments*). They are downloaded when first used: General MIDI soundfonts (MusyngKite) for strings, brass, woodwinds, choir, harp, mallets, guitars and basses, a sampled Steinway grand, electric pianos (Wurlitzer, CP80) and classic drum machines (TR-808, LinnDrum LM-2, Casio RZ-1). Until an instrument is ready, or if it can't load, its synthesized fallback plays with the same envelope and filter values. The image reaches sampled notes through their low-pass cutoff, release and velocity. Sampled defaults:

| Style | Melody | Harmony | Bass | Pad | Story melody |
|---|---|---|---|---|---|
| Ambient | Grand piano | Vibraphone | synth | synth | Flute |
| Cinematic | Orchestral harp | String ensemble | Cello | synth | Violin |
| Minimal | Vibraphone | Marimba | synth | synth | Vibraphone |
| Jazz | Jazz guitar | Wurlitzer | Acoustic bass | synth | Tenor sax |
| Electronic | synth | synth | synth | synth | Synth lead |
| Orchestral epic | French horns | String ensemble | Contrabass | Choir | French horns |
| Movie score | Grand piano | String ensemble | Cello | Synth strings | Violin |
| Lo-fi hip hop | Yamaha CP80 | Wurlitzer | Electric bass | synth | Flute |
| Bossa nova | Flute | Nylon guitar | Acoustic bass | String ensemble | Flute |
| Synthwave | synth | synth | synth | synth | Saw lead |
| Classical | Grand piano | Grand piano | Cello | String ensemble | Violin |

**Drum kits** (Sound tab, Rhythm channel): the style default, the synthesized kit, TR-808, LM-2, RZ-1 or the orchestral kit (taiko on the kick and toms, timpani for rolls, tuned to the piece).

### 9.3 Instrument library and editor

Every style instrument is a preset in a library (`src/core/instruments.js`), with the synthesized extras (Glass bell, Warm keys, Warm lead, Pure tone, Soft brass, Soft lead, Synth lead, Nylon string, Texture wavetable, Texture pad) and the sampled instruments. In the Sound tab each pitched layer can use the style default or any preset, and its parameters can be edited (attack, release, filter, resonance, colour, plus decay, sustain, string T60, FM ratio or detune depending on the type). The image modulates the chosen instrument exactly as in §8.

### 9.4 Texture wavetable

The wavetable instrument takes its waveform from the image. For each focus point, the luminance of the processed image (what the analysis sees, at up to 1024 px) is sampled at 256 points along a line through the point, in the dominant gradient direction of its area (across the edges, so stripes become a periodic waveform), over a length of 2r of the diagonal. The linear trend is removed so the cycle closes, a real FFT (fft.js, MIT) gives the first 64 harmonics, and `createPeriodicWave` plays them, band-limited by construction. The colour parameter tilts the spectrum: harmonic k is scaled by `k^(−2(1 − colour))`, so colour 1 keeps the texture's spectrum and colour 0 keeps mostly the fundamental. A flat area falls back to a soft odd-harmonic wave. A wavetable pad reads a wider profile (r = 0.3) through the image centre. Stripes with a period of 8 px over a 64 px profile give the 8th harmonic as the strongest (tested). The style sets the frame (tempo, modes, instruments, space), but the image still decides what happens inside it.

---

## 10. Controls

The interface shows only the essentials by default; the rest is in collapsed "Advanced" groups.

| Where | Control | Range | Default | Effect |
|---|---|---|---|---|
| Piece | Style | 5 styles | Ambient | musical frame and instruments |
| | Duration | 15 / 30 / 60 s | 30 s | exact length of the piece |
| | Focus points | 2 up to the maximum the duration allows | 8 | how many distinct places the eye reads (circles on the stage) |
| | Returns | 0-12 | 3 | at most how many times the eye goes back to a place already seen |
| | Tempo | −30%…+30% | 0 | adjustment over the style tempo, before rounding to bars |
| Advanced: gaze | Inhibition radius | 6-40% of the diagonal | 18% | how far the eye jumps |
| | Memory | 0-20% | 5% | how quickly a seen area becomes attractive again, so how early the returns come |
| | Variation | 0-99 | 0 | seed for deterministic alternative paths |
| Advanced: what draws the eye | Colour, Texture, Semantic | 0-100% | 70%, 50%, 60% | saliency map weights |
| | Dramatic arc | 0-100% | 70% | §7.10 |
| | Smooth transitions | 0-100% | 60% | §7.7 |
| Advanced: music | Key, Scale | Auto, 12 keys; Auto, 6 modes, 2 pentatonics | Auto | manual key and scale |
| | Fidelity | 0-100% | 60% | literal (high) or smoothed (low) melody |
| | Melody octave | −2…+2 | 0 | shifts the melody by octaves |
| | Melodic range | 1-3 octaves | 2 | span of the image height in the melody |
| Sound, Master | Image timbre | 0-100% | 100% | how much the areas modulate the instruments |
| | Space | 0-100% | per style | reverb return level |
| | Reverb size, pre-delay, damping | 0.5-8 s, 0-150 ms, 20 Hz-20 kHz | 3.4 s, 0, 20 kHz | §11 |
| | Delay return, time, feedback, tone | 0-100%, 1/8 to 1/2, 0-90%, Hz | 0, 3/16, 35%, 4.5 kHz | tempo-synced |
| | Chorus mix, rate, depth | 0-100%, 0.05-3 Hz, 0-8 ms | 0, 0.6 Hz, 4 ms | |
| | Compressor threshold, ratio; limiter ceiling; output | dB | −16 dB, 3.5:1, −1 dB, 0 dB | |
| | Export loudness | −14 LUFS or peak 0.9 | −14 LUFS | §12 |
| Sound, each channel | Equalizer | 6 bands | flat | low cut, low shelf, two peaks, high shelf, high cut; drag the dots, scroll for Q |
| Sound, each layer | Instrument, edits | library | style default | §9.1 |
| | Drive, reverb send, delay send | 0-100% | 0, per layer, melody 30% harmony 15% | |
| Timeline | Mute, Solo, volume per layer | 0-150% | 100% | if any layer is soloed, only soloed layers are heard |

Every slider has an editable numeric field; double-clicking its label restores the default. Changing a control during playback recomputes the piece and playback continues from the current position. Keyboard: Space plays and pauses, `[` and `]` select the previous and next focus point.

---

## 11. Audio engine

Sound is synthesized with the Web Audio API, fully deterministically.

- **Pluck (melody): Karplus-Strong.** The loop has a delay of N samples, an averaging filter (0.5 samples) and a first-order allpass for the fractional part δ, with `C = (1 − δ)/(1 + δ)`, so the total delay is exactly `sr / f`. The per-period gain `g = 0.001^(1/(T60·f))` decays the string by 60 dB in T60 seconds. The excitation is fixed-seed noise through a first-order low-pass controlled by the colour parameter. The buffer is computed in JavaScript and cached (T60 quantized to 1/12 octave, colour to 0.05). Measured tuning error is under 1 cent.
- **2-operator FM (harmony).** Sine carrier at f, modulator at `ratio·f`; the index `0.3 + 4·colour` decays to 25% with the decay time constant. Then a low-pass filter and ADSR.
- **Bass.** Sine plus sawtooth (mix set by colour), a filter with a short envelope, ADSR.
- **Pad.** Three detuned sawtooths (−det, 0, +det cents) spread in stereo (−0.6, 0, +0.6), plus a triangle; their balance is set by colour; low-pass filter and slow ADSR.
- **Percussion**: the kick is a sine with a pitch glide; toms are sines falling from 1.6× to their pitch (92, 128, 172 Hz). Snare: band-passed noise plus a short triangle body; clap: three noise bursts and a tail; rim: a short high square click. Hi-hats (closed, pedal, open), ride, shaker and crash are high-passed noise with different decays. The position in the noise buffer depends on the beat, so the same hit sounds the same on every playback.
- **Vibrato** on sustained leads (instrument parameter `vib`, 6-10 cents): a 5.2 Hz sine that fades in 0.3-0.8 s after the attack, only on notes longer than 0.5 s.
- **Texture wavetable**: an oscillator with the point's PeriodicWave (§9.2), low-pass filter and ADSR.
- **Mixing** (native Web Audio nodes only):

  ```
  voices -> layer input -> drive (tanh, 4x oversampled) -> 6-band EQ -> fader (volume, mute, solo) -> master bus
                                                             |-> reverb send -> pre-delay -> convolver -> damping -> return
                                                             |-> delay send -> delay (feedback through a tone low-pass) -> return
  master bus + returns -> master EQ -> chorus (dry + delay modulated by a sine LFO) -> compressor
  -> makeup -> limiter (ratio 20, knee 0, 1 ms attack) -> output
  ```

  The reverb impulse is seeded decaying noise whose length is the Size control; the chorus LFO starts at time 0, so offline renders are deterministic. Settings change live during playback; a new reverb size swaps the convolver.
- **Glides** (§7.7): filter cutoff, Q and pan of the notes that start a focus point ramp from the previous point's values.
- **Scheduling**: a scheduler with a 350 ms window schedules notes as playback advances.

Layer balance was set from measured RMS on offline renders: the melody has the highest peaks, the bass is trimmed so that it does not dominate.

Determinism: every random source (Variation noise, reverb impulse, percussion noise, Karplus-Strong excitation, demo images) uses a fixed-seed PRNG (mulberry32). The only exception is the semantic analysis, cached per image (by a pixel hash) for the session. The guarantee holds within the same JavaScript engine; across browsers, image decoding and resizing may differ.

---

## 12. Export

Everything is exported from the **Export** tab (the Export button in the top bar opens it). Every export first waits for the neural models the piece uses, so the file is the piece you hear; layers that are off in the mixer are left out.

| Export | What |
|---|---|
| **Audio** | WAV 16-bit, WAV 24-bit, MP3 (320, 192 or 128 kbps) or M4A/AAC (256, 192 or 128 kbps), named after the image |
| **MIDI** | the `.mid` file below on its own |
| **Everything (ZIP)** | `sonification.mid`, `sonification.wav` (16-bit), `parameters.json` and the recipe |
| **Video** | MP4 or WebM of the image with the gaze path drawn in time with the music, a looping GIF, or a PNG poster (§12.1) |

All the audio formats start from the same master (the offline render below, with the loudness gain). WAV is written by the app; M4A uses the browser's AAC encoder (WebCodecs) packed by mp4-muxer (MIT), and is offered only where the browser can encode AAC; MP3 uses LAME (lamejs 1.2.1, LGPL), downloaded from jsDelivr the first time MP3 is chosen and never bundled.

### `sonification.mid`

Type 1 MIDI, 480 PPQ, with a tempo track and one track per audible layer. Every track ends exactly at the end of the piece.

| Track | Channel |
|---|---|
| Melody | 1 |
| Harmony | 2 |
| Bass | 3 |
| Pad | 4 |
| Rhythm | 10 (GM percussion) |

Each style sets General MIDI programs matching its instruments. The timbre of each focus point (and of the cadence) is written as **Control Change** messages at its start, on melody and harmony, with that layer's parameters:

| CC | Parameter | Encoding |
|---|---|---|
| 73 | Attack | `√(attack in s) · 127` |
| 75 | Decay | `√(decay / 4 s) · 127` |
| 72 | Release | `√(release / 3 s) · 127` |
| 74 | Brightness (cutoff) | `log2(cutoff / 300 Hz) / 5.5 · 127` |
| 71 | Resonance | `Q / 12 · 127` |
| 10 | Pan | from the horizontal position (harmony at 40%) |

### `sonification.wav`

Offline render, stereo, 44.1 kHz, 16-bit, exactly T seconds, through the same effects as playback. The master fades out linearly over the last 0.4 s so the reverb is not cut audibly.

**Loudness** (default): normalized to **−14 LUFS** integrated, the level streaming and social platforms normalize to. Integrated loudness and true peak are measured per ITU-R BS.1770-4 with lufs-web (MIT), verified in the tests against the standard's calibration (a full-scale 997 Hz sine in one channel reads −3.01 LKFS) and a −20 dBFS stereo sine (−20 LUFS, −20 dBTP). The gain is capped so the true peak stays under −1 dBTP. If that cap stops the gain short of −14 LUFS, a second render drives the master limiter with a makeup gain equal to the distance from the true peak at its input to its ceiling plus 1.5 times the missing loudness; on the demo this gives −14.0 LUFS at −1.6 dBTP. The export status reports the measured loudness and true peak. **Peak 0.9** normalizes the sample peak to 0.9 instead.

### 12.1 Video

The video is the stage's overlay animated over the piece (`src/export/video.js`, with `paths.js`, `look.js`, `reactive.js` and `labels.js`). One function draws the frame for a time in seconds; the stage uses it as a live preview while the Export tab is open (press play to watch the video as it will be exported), and the encoders for every frame, so the preview is the file. The settings are grouped in the tab as Video, Look, Camera, Path and places, Labels on places, Effects and sound, Text and timing.

**Formats**

| | |
|---|---|
| MP4 | H.264 (else VP9 or AV1) and AAC 192 kbps (else Opus), mp4-muxer |
| WebM | VP9 (else VP8 or AV1) and Opus 160 kbps (resampled to 48 kHz when the browser asks for it), webm-muxer |
| GIF | silent, looping, 360/480/640 px wide, 10/12/15 fps, 256 colours per frame (gifenc); 8 s around the climax (from 1.5 s before it), the first 10 s, or the whole piece |
| Cover | messaging apps show a video's first frame as its preview, and the video fades in from black, so the first frame is a cover: the frame at the climax (0.45 s after the eye arrives, with the title shown even when it otherwise shows only at the start), the frame at a chosen second, or the user's own image (filling the frame; kept in memory, not in recipes). It stays 0-3 s (default 0.5 s), then blends into the video over the fade-in time, which replaces the fade from black. Stopped at the start, the preview shows the cover. MP4 and WebM |
| Poster | a PNG of the frame at the playhead, at the video's size; at the very start, the frame 0.45 s after the eye reaches the climax |

**Frame**

| | Rule |
|---|---|
| Size | by default the video has the image's own size and shape (even sides; at most 3840 px long and 8.8 MP, what H.264 level 5.1 encodes; at least 240 px), so it looks like the image; or a short side of 720, 1080, 1440 or 2160 px. The tab says the resulting size |
| Shape (Advanced) | like the image (at most 2.4:1), 16:9, 1:1, 4:5 or 9:16; 24, 30 or 60 fps |
| Quality | Standard, High or Master: 0.08, 0.14 or 0.24 bit per pixel; a key frame every 2 s |
| Safe area | in 9:16 and 4:5 the text keeps out of where the apps draw their buttons (9:16: 13% top, 22% bottom, 15% right, 6% left); the preview can show these zones (never exported) |
| Framing | *Fill the frame* crops the image to the frame's shape; *Whole image* fits it, over a blurred, darkened copy |

**Camera**: *Still*, or *Follow the eye*: the camera aims at each place in turn, moving over a window centred on each boundary (*Move time*, 0.4-4 s, at most 0.45 of each neighbouring point) with a *Motion* curve: Linear, Gentle (sine), Smooth (quintic smootherstep) or Cinematic (exponential in-out); the zoom (0-100% closer) eases in over the first 1.5 s and out over the cadence. *Smoothing* passes the aimed view (centre and zoom, kept inside the image) through a critically damped spring with time constant 1.2 × smoothing s, read that far ahead so it still arrives on time: consecutive moves blend into one glide, without stops or jerks. *Slow push-in* (0-30%) zooms in steadily over the whole piece, with either camera. The track is computed once, 60 times a second, and every frame reads it.

**Path and places**

| | Rule |
|---|---|
| The eye | stays on a point until its connection to the next one starts (the first passage note, §7.7a; without one, in the last quarter of the point, at most half a beat), then moves along the path with a smoothstep and arrives on the next point's first beat. Shown as a dot, a comet (a longer trail), a ring, or not at all |
| Path | *As it plays* (only the travelled part), *From the start* (the whole path, the part still ahead at its own opacity), *Last jump*, or off; the travelled part and the part ahead each have an opacity (0-100%); width 1-12 px (at 1080p) |
| Shape | straight segments, or *Curved*: a cardinal spline through the points (tension 0.3), which the eye and the connection notes follow too |
| Line options | *How much it curves* (curved paths, the spline's tension), *Glow* (Glow and Neon), dash length and gap (Dashed, Dotted, Marching, as multiples of the width); *Line colour*: one colour, *Along the path* (from a start colour to an end colour, segment by segment) or *Follows the story* (from a calm colour to a tense one with each point's tension) |
| Line style | Solid, Glow, Neon (a coloured halo with a white core), Dashed, Dotted, Marching (dashes moving forward), Tapered (thin where it started, full at the eye), Comet (a tail that fades behind the eye), Brush (three thin strokes with a fixed wobble), Arrows (a chevron in the middle of each jump), Double (two parallel lines). The part still ahead is drawn solid for the Tapered and Comet styles |
| Place options | circles as a ring, filled, dashed, a dot or none; their size (40-200%); numbers in a pill, plain or none; the climax in its own colour |
| Places | *As it plays* (they appear when the eye first arrives, growing in), *From the start*, *Current only*, or off. The current place is fully opaque; a visited place fades to the *Visited* opacity in 0.5 s after the eye leaves; with From the start, a place not reached yet has the *Still ahead* opacity and rises to full in 0.35 s on arrival. Numbers optional; revisits share a marker |
| Connection notes | dots along the path where the passage notes come from, with the opacity of their part of the path, lit while they play |

**Labels on places** (`labels.js`): *Detected* names each place after the object under it: the smallest box containing the point among the objects found by the Objects placement, by Claude, or by *Detect objects* in the tab (COCO-SSD, run once per image), else the nearest box centre within 12% of the image; a place on no object is described by its region's colour and light (hue name, bright/dark/deep, highlight/shadow/detail: "bright warm light", "deep blue shadow"). *My own* takes the user's text for each place by its number (empty: no label; *Fill in the detected names* copies the automatic ones to edit). A label is a pill above the place (below it near the top of the frame), rising in over 0.35 s when the eye arrives and fading 0.5 s after it leaves, or kept at the visited opacity.

**Effects and sound**

| | Rule |
|---|---|
| When the eye arrives | *Pulse* (a ring that expands and fades in 1.1 s), *Ripple* (three thinner rings), *Spotlight* (the rest of the frame darkens around the eye), *Glow* (light on the current place, strongest on arrival), *Flash on accents* (a short white flash on accented points and the climax); 1.6 × stronger at the climax; *Effect strength* scales them all |
| React to the sound | the beats of the rendered sound (`reactive.js`: the positive change of the 40-160 Hz band, normalized by a running peak, held with a 0.18 s decay) widen the line (up to +35%), throb a ring on the current place, brighten the glow and grow the eye. The preview starts from the notes (kick and accent hits) and switches to the rendered sound once the piece has been rendered in the background (the render is kept and reused by the next export) |
| Bottom colour | *One colour*; a *Gradient* from left to right between two colours; or *Follows the sound*: each bar (or the whole line) moves from the *Quiet* colour to the *Loud* one with its own level and the loudness and beat at that moment (`0.55·level + 0.45·max(loudness, beat)`); played overview bars take the colour of their height |
| Bottom | *Sound bars* (an overview of the loudness, the played part in the place colour), *Spectrum* (40 log-spaced bands from 40 Hz to 16 kHz, FFT 2048, falling with a 0.25 s release), *Waveform* (the signal over 40 ms around the playhead), a *Progress line*, or none |

**Look** (`look.js`)

| | Rule |
|---|---|
| More colours | the spotlight and the vignette in any colour (not only black); a tint over the whole picture (soft light), with an amount |
| Colours | six themes (Gold, Neon, Ember, Mint, Rose, White) or any two colours: the path, and the places and effects. A theme also sets the bottom's colours. Every other element has its own colour: the title, the line under it (and the chord line), the eye, the labels (text and background) and the bottom |
| Colour grade | Warm, Cool, Contrast (an S-curve), Vivid (saturation), Matte (lifted blacks, softer colour), Black and white, Teal and orange (shadows toward teal, highlights toward orange), with an amount; applied once to the image, pixel by pixel |
| Vignette, grain, darken | a radial darkening to the corners; seeded film grain (four tiles cycled frame by frame, so the export is the same every time); a dark layer over the image |
| Looks | six built in (Minimal, Neon night, Documentary, Cinematic, Sketchbook, Audiogram) and your own, saved in the browser under a name; a look holds every choice of these groups but not the size, the title or the labels |

**Text and timing**

| | Rule |
|---|---|
| Text placement | the title (with the line under it) and the chord line can be dragged anywhere on the preview: they snap to the centre, the thirds and the safe margins, with guides while they move, and keep their place as a fraction of the frame (so it holds at any size); *Reset position* goes back to the presets. Alignment left, centre or right |
| Text look | a soft shadow, an outline, a box behind the text (in any colour) or plain; capitals; letter spacing; the title comes in with a fade, rising, typed letter by letter, or at once |
| Title | the image name or your own; under it the style, key and tempo, a line of your own, or nothing; top left, top centre, bottom left or centre; always, or only the first seconds (in over 0.6 s, shown for 1-15 s, then out over 1 s); *Title and chords* adds each point's section and chord at the bottom. Stopped at the very start, the preview shows the frame at 1 s, since the first frame is black when the video fades in |
| Font | Geist, Space Grotesk, Instrument Serif, Playfair Display, Bebas Neue (in capitals) or Geist Mono (Google Fonts, loaded when chosen), with a size of 60-180% |
| End card | the last 3.2 s: the picture darkens, the title is shown large in the centre with the style line and a credit ("Made with Lux Sonora", editable) |
| Fades | from black over the first 0-3 s and to black over the last 0-4 s; the sound fades with the picture (optional) |

The image is used at up to 2.5 × the frame's long side, so the zoom stays sharp. A 30 s, 720 × 1280, 24 fps MP4 takes a few seconds on a recent laptop; 4K takes several times longer. Video export needs Chrome, Edge or Safari 17 or newer (the GIF and the poster work everywhere).

The look, the labels and the format are saved in recipes with the other settings.

### `parameters.json`

Schema 2, with English field names. Everything needed to reproduce or port the result:

- style, key, mode, duration, tempo (and the style tempo before rounding), bars, beats, settings and mixer;
- global features and the timbre reference (mean and standard deviation of each feature over the image);
- the semantic analysis result, if any;
- for each focus point: position, saliency, weight, start and duration (in beats and seconds), share of the piece, motif family and variant, chord, melody, bass, pan, region features, modulation vector and per-layer timbre;
- the cadence and the pad timbre.

---

## 13. Semantic analysis (with Claude)

When the app is published as a claude.ai artifact, the **Atmosphere and objects** panel appears. The image, reduced to 768 px, is sent to Claude, which replies with JSON:

```json
{
  "atmosphere": [{ "label": "calm", "score": 0.8 }],
  "valence": 0.6,
  "energy": 0.3,
  "objects": [
    { "name": "boat", "category": "artificial",
      "x": 0.4, "y": 0.6, "w": 0.1, "h": 0.08, "importance": 0.7 }
  ]
}
```

The reply is validated (fields clamped to 0-1, at most 8 objects, unknown categories become "natural") and used in three places:

- **valence and energy** shift the mode and tempo;
- **objects** raise the saliency of the regions they cover, so they draw the eye;
- **the object's category** colours the timbre of focus points that land on it.

When the HTML file is opened locally or on GitHub Pages, the panel stays hidden and the rest of the app works normally.

---

## 14. Interface

- **App layout**: a slim top bar (upload, demo, transport, appearance, export), the stage on the left, the inspector on the right, the timeline at the bottom. On desktop everything fits the window; on small screens the parts stack.
- **Stage**: the image on a dark background. A segmented control switches the view (Image, Attention, Edges, Regions, Coverage); a switch hides the gaze path. Focus points are drawn as numbered circles sized by duration. Clicking one opens the Focus point tab and plays only that point.
- **Loading**: a progress card over the stage while a file decodes, with Cancel. The Piece tab starts with **Image info** (name, pixel size, megapixels, format, file size, bit depth and sample type, how it is read, size of the working copy) and the collapsed **Analysis source** group (§2.3), opened automatically for measurement data.
- **Simple and Advanced** (top of the Piece tab, remembered in the browser; Simple is the default for a first visit). Simple shows the main choices only: style, duration, melody, orchestration, where the eye looks and the number of focus points; on the stage the Image and Eye map views, the gaze path switch, Add point, undo and redo; in the Sound tab sampled instruments, image timbre, space and each layer's instrument. Advanced adds groove, revisits, tempo, build-up, smoothness, the analysis source (always shown for measurement data), the advanced groups, the Edges, Regions and Coverage views, the path modes, the equalizers, the channel and master effects and the export loudness.
- **Plain labels**: Placement is shown as *Where the eye looks*, the Attention view as *Eye map*, Returns as *Revisits*, Dramatic arc as *Build-up* and Smooth transitions as *Smoothness* (the documentation keeps the technical names).
- **The Piece tab in cards**: *Music* (style with a one-line description, duration, melody, connections, orchestration, groove), *Image* (image info, where the eye looks, analysis source), *Shape* (focus points, revisits, tempo, build-up, smoothness), then the advanced groups.
- **Why it sounds like this**: a line over the stage explains the selected focus point: its section, its chord and the two or three strongest links from its area to the sound (height → register, smoothness → legato, sharp edges → attack, texture → brightness, colour → resonance and harmonics). Hidden on phones, where the Focus point tab has the same information.
- **One status line** next to Export says what is downloading (instruments, the melody, groove or saliency models), with a pulsing dot.
- **Phones**: a compact top bar (icon-only upload, no app name) that stays at the top while scrolling.
- **Welcome page** (first visit; again with *Welcome* in the top bar): what the app does in a paragraph, the three steps (choose an image, generate a song, shape and share), what it offers (16 styles, sampled instruments and optional neural networks, the analysis in the browser, reproducible recipes, open source), *Upload an image* or *Try a demo*, and the credits: developed by Pericle, with a link and a QR code to the Instagram account @pericle_v. The About dialog has the same credit.
- **First run**: after the welcome page, a short guide on the stage (upload, new song, shape it) with *Upload a photo*, *New song* and *Keyboard shortcuts*; it can be shown again from *About and licence*.
- **New song** (top bar; opens by itself after an upload): genre, duration, the number of focus points (with a suggestion from the image, `4 + 10·(0.5·entropy + 0.5·edges)`) and where the eye looks. *Generate song* places the points with that method (press play when you like); the points can then be moved, added, removed and given a role. *Place the points myself* starts an empty manual path with the Add tool on and a short hint: click the image in the order the places should be heard, then set each point's role in the Focus point tab.
- **Top bar**: *Welcome* opens the welcome page; *Help* has Getting started (the quick start guide, which has a close button), Keyboard shortcuts (also `?`) and About and licence (version, MIT licence, credits); the folder icon holds Save recipe and Open recipe.
- **Pickers**: instruments and drum kits are chosen in a dialog with search, a family filter and a *Listen* button (an arpeggio in the layer's register, or a bar of drums); the list holds the style default, recommended sampled instruments, the synthesizers, all 128 General MIDI soundfonts by family, Mellotron, VCSL mallets and electric pianos, and 225 kits (built in, classic drum machines and 220 DrumAbuse machines).
- **Inspector**, four tabs:
  - **Piece**: placement, style, duration, melody, groove, focus points, tempo (with the resulting BPM and bars), then the collapsed groups Advanced: gaze, what draws the eye, music, and "How the image was read". Group state is kept locally in the browser.
  - **Focus point**: time received (seconds, share, beats), the envelopes of the three layers overlaid, the modulation vector with the source of each component (the area's value against the image mean), per-layer parameters, music (melody, chord, bass, stereo) and area features. Arrows move to the previous or next point.
  - **Sound**: Image timbre, Space, and the instrument of each layer.
  - **Export**: audio (format and bit rate), MIDI, the ZIP, and the video with its look (§12.1). While it is open the stage shows the video preview.
- **Play waits for the models**: when a neural model is still downloading or working, pressing Play shows a spinner and the piece starts when the result is in (pressing again cancels). Nothing starts by itself, so what you hear is the finished piece.
- **Timeline**: one lane per layer with its instrument, Mute, Solo and volume in the lane header; bar lines, numbered segments for each focus point, the cadence ("End") and the playhead. Clicking seeks there.
- **Appearance**: System, Light or Dark theme, and a choice of six accent colours, remembered in the browser.
- Images can be loaded with the button or by drag and drop.

---

## 15. Known limitations

- **Neural placement** depends on what the models know: COCO-SSD finds only its 80 everyday classes (nothing in drawings, abstract images or micrographs), and MSI-Net was trained on photographs of scenes.
- **Sampled instruments** play from General MIDI soundfonts: convincing, but not a studio orchestra; the image modulates their filter, release and loudness, not their attack.

- **Story melody needs the network** the first time (the model is not bundled) and a GPU to be fast. Magenta.js 1.23.1 (last released in 2022) pulls TensorFlow.js 2.8 and old dependencies with known advisories (protobufjs, minimist, static-eval); they are only loaded when Story is chosen.
- **Determinism of the story across machines** relies on argmax decoding; WebGL arithmetic differs slightly between GPUs, so a near tie could pick another note on another machine.

- **Footprint features are region-weighted**: the footprint weights regions, so non-linear features (entropy, edge sharpness) are averaged per region rather than recomputed per pixel.
- **Glides act on filter, Q and pan**; attack and release cannot change inside a sounding note, so they change at the next note.
- **The analysed image has 200 px on its long side**, so SLIC misses small objects, like the boat in the demo image. Semantic analysis or a higher resolution (Phase 4) solves this.
- **Saliency is classical**, based on contrast and texture, not on a model trained on eye-tracking data.
- **No forced connectivity in SLIC**: a region can have disjoint fragments.
- **Focus point durations do not align to bars**, only the whole piece and the cadence do.
- **Layer balance** is set on RMS; only the export is normalized on loudness (LUFS).
- **The synthesizers are simple**, but distinct per layer, editable and processed by EQ and effects. For studio quality the MIDI CCs can drive an external synthesizer (Surge XT, Vital).
- **The limiter is a fast compressor** (Web Audio has no look-ahead limiter); export loudness stays honest because the final gain is capped by the measured true peak.

---

## 16. Next steps: Python port

| Component in the web app | Proposed Python equivalent |
|---|---|
| Sobel, entropy, histograms | OpenCV, scikit-image |
| Own SLIC | `skimage.segmentation.slic` or SAM for semantic regions |
| Region-contrast saliency | spectral residual (OpenCV) or DeepGaze IIE |
| Atmosphere via Claude | CLIP zero-shot on a list of atmosphere labels |
| Objects via Claude | YOLO or DETR, with classes mapped to living / natural / artificial |
| Music theory | music21 |
| MIDI writing | pretty_midi or mido |
| Web Audio synthesis | DawDreamer with Surge XT / Vital, parameters automated from the computed timbre |

The Python core should read and write the same format as `parameters.json`, so both implementations can be compared directly on the same images.

Validation tests:

- **Determinism**: the same image must give the same MIDI.
- **Robustness**: a small crop should give similar music.
- **Listening**: people get three images and one sound and must guess the image.
