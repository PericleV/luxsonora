# Research: similar software and open-source building blocks

Survey done on 2026-11-06 to decide what Lux Sonora (then called Sonification) should borrow instead of reinventing. Sources are listed at the end.

## 1. Similar software

| Tool | Paradigm | Notable options | What we take |
|---|---|---|---|
| **The vOICe** (Peter Meijer, free for non-commercial use) | Left-to-right scan: height → pitch, brightness → loudness, stereo pan follows the scan | Live camera input; image reduced to a coarse grid with 16 grey levels; stereo panning | Grayscale / channel-mix analysis source; a **Scan** path mode as an alternative to the gaze path (later) |
| **Pixelsynth** (Olivia Jack, browser, open source) | Playhead crosses bright pixels; height → pitch | Monochrome conversion, invert, brightness, contrast, rotate, tile; root note, octaves, scale, playhead speed and direction; drawing | Invert / brightness / contrast / gamma before analysis; **manual key, scale and octave range** (override of the automatic choice) |
| **Photosounder**, **MetaSynth Image Synth**, **Virtual ANS**, **Coagula** | Image as spectrogram, additive synthesis (rows are sine partials) | Spectral painting, sound ↔ image both ways, loop modes | Optional **spectral texture layer** that plays the area around each focus point as a spectrogram (later) |
| **SonicPhoto** | Spectrogram synthesis | Automatic stereo, harmony filter (snap to scale) | Already covered: notes are quantized to the mode |
| **Serum** (commercial synth) | Wavetable | Imports images: rows become single-cycle waveforms | **Texture wavetable** instrument: the luminance profile through a focus point becomes the oscillator waveform |
| **Seeing Aural** (TEI 2014) | Gaze → sound | Hue, saturation and brightness of the gazed material drive sound | Confirms our per-area feature mapping |
| **EyeMusic** (NIME 2007), **EyeHarp** (2016) | Live gaze as instrument | Eye tracker → Max/MSP; step sequencer + melody layer | Import of real eye-tracker focus points (planned) |
| **Spotty** (Evreinov, ICAD 2001) | Theory | Proposes scanpath theory to guide image sonification; asks whether trajectory or fixation spots should drive sound | Academic precedent for our approach: we use both (spots → notes/timbre, saccades → melodic steps) |
| **Astronify / SonAD** (STScI, open source) | Data series → pitch over time | Column-to-pitch mapping; SonAD converts images to scatter plots | Not directly applicable |

A study of sonified paintings (Dam et al., Virginia Tech) found that richer, musician-enhanced audio increased engagement more than basic audio. This supports investing in sound quality (instruments, EQ, effects), not only in the mapping.

Nothing found sonifies a full scanpath into structured music the way Lux Sonora does; the closest works are live gaze instruments and the Spotty proposal.

## 2. Open-source building blocks

| Need | Candidate | License | Notes and risks |
|---|---|---|---|
| Effects, routing, offline render | **Tone.js** (v15) | MIT | Has Chorus, Distortion, FeedbackDelay, Reverb, EQ3, Compressor, Limiter, Offline rendering. Its Reverb builds the impulse response from random noise, so we keep our own seeded IR through a Convolver to stay deterministic. Adds roughly 300 kB to the single HTML file. |
| Parametric EQ | **weq8** | ISC | Web Audio parametric EQ on BiquadFilterNodes (low/high pass, shelves, peaking, notch) with a `<weq8-ui>` web component. To evaluate: styling, theming, offline use. Fallback: our own SVG curve from the native `BiquadFilterNode.getFrequencyResponse()`. |
| EQ curve drawing only | **DSSSP** | not confirmed | React, SVG; we do not use React, so only as reference. |
| Loudness (LUFS) for export | **lufs-web** | MIT | BS.1770-4 integrated loudness with gating, LRA, true peak; no dependencies. Very new (0.1.x): we verify it against the standard's reference signals in our tests; fallback is a K-weighting implementation of our own. |
| FFT for wavetables | **fft.js** | MIT | Radix-4, no dependencies, real-input transform. |
| Wavetable playback | native `createPeriodicWave` | (platform) | Takes Fourier coefficients and normalizes them; band-limited by construction if we cap the number of harmonics. |

## 3. Decisions derived from the research

1. Analysis source settings (Color, Grayscale, Custom RGB mix; invert, brightness, contrast, gamma), as in The vOICe and Pixelsynth.
2. Manual key, scale and octave range, with Auto as default, as in Pixelsynth.
3. Texture wavetable instrument, as in Serum's image import, built on fft.js and `createPeriodicWave`.
4. Audio engine moves to Tone.js for effects and routing; reverb keeps a seeded impulse response.
5. Parametric EQ per layer and on the master, starting from weq8.
6. Export normalized to −14 LUFS, measured with lufs-web after verification.
7. Later: Scan path mode (The vOICe), spectral texture layer (Photosounder, Virtual ANS).

## Sources

- [The vOICe home page](https://www.seeingwithsound.com/voicover.htm)
- [Seeing with your ears: Peter Meijer's vOICe (NTU phonetics notes)](https://homepage.ntu.edu.tw/~karchung/Phonetics%20II%20page%20eighteenb.htm)
- [Pixelsynth turns images into music (FACT)](https://factmag.com/2016/05/24/pixelsynth-browser-instrument-turns-images-into-music)
- [Pixelsynth (MusicRadar)](https://www.musicradar.com/news/tech/the-noise-of-art-pixelsynth-can-turn-your-images-into-music-for-free-638423)
- [Photosounder review (KVR)](https://www.kvraudio.com/product/5336/review)
- [Visual synthesis roundup (gearnews)](https://www.gearnews.com/visual-synthesis-synth/)
- [Virtual ANS v3 preview (Synthtopia)](https://www.synthtopia.com/?p=108976)
- [SonicPhoto (Synthtopia)](https://synthtopia.com/content/2012/09/04/sonicphoto-turns-photos-into-sound)
- [Image-based wavetables, Serum rows as cycles (Derivative forum)](https://forum.derivative.ca/t/how-do-i-transform-textures-into-sound/137949)
- [EyeMusic, University of Oregon](https://www.cs.uoregon.edu/research/cm-hci/EyeMusic)
- [Spotty: imaging sonification based on spot-mapping (Georgia Tech repository)](https://repository.gatech.edu/entities/publication/2cbd8c40-c21f-4327-96f0-dad1ddee4190)
- [Seeing Aural (TU Eindhoven)](https://research.tue.nl/en/publications/seeing-aural-an-installation-transferring-the-materials-you-gaze-/)
- [EyeHarp (Frontiers in Psychology)](https://frontiersin.org/articles/10.3389/fpsyg.2016.00906/pdf)
- [Audio augmented reality for visual art (Virginia Tech)](https://vtechworks.lib.vt.edu/bitstreams/fc63dab0-b397-4e94-8471-5992d326cf4f/download)
- [Astronify documentation](https://astronify.readthedocs.io/en/latest/astronify/index.html)
- [SonAD (ASCL)](https://ui.adsabs.harvard.edu/abs/2024ascl.soft08006S/abstract)
- [Tone.js documentation](https://tonejs.github.io/docs/15.1.22)
- [Tone.js Reverb](https://tonejs.github.io/docs/15.1.22/classes/Reverb.html)
- [weq8 (GitHub)](https://github.com/teropa/weq8)
- [DSSSP announcement (KVR forum)](https://www.kvraudio.com/forum/viewtopic.php?p=9271396)
- [lufs-web (pkgstats)](https://www.pkgstats.com/pkg:lufs-web)
- [Needles LUFS meter (GitHub)](https://github.com/domchristie/needles)
- [fft.js (npm)](https://www.npmjs.com/package/fft.js)
- [createPeriodicWave API](https://api.dart.dev/dev/2.0.0-dev.43.0/dart-web_audio/BaseAudioContext/createPeriodicWave.html)
