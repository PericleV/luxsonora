# Third-party notices

Lux Sonora is released under the MIT License (see `LICENSE`). It bundles or downloads the
following third-party components, each under its own license.

## Bundled libraries (inside `dist/index.html`)

| Component | License | Use |
|---|---|---|
| [geotiff.js](https://github.com/geotiffjs/geotiff.js) | MIT | TIFF decoding (SEM/TEM data) |
| [fft.js](https://github.com/indutny/fft.js) | MIT | texture wavetables, spectral residual saliency |
| [lufs-web](https://www.npmjs.com/package/lufs-web) | MIT | loudness measurement (ITU-R BS.1770-4) |
| [smplr](https://github.com/danigb/smplr) | MIT | sampled instruments player |
| [Magenta.js](https://github.com/magenta/magenta-js) (`@magenta/music`) | Apache-2.0 | MusicVAE, ImprovRNN, GrooVAE inference |
| [TensorFlow.js](https://github.com/tensorflow/tfjs) | Apache-2.0 | neural network runtime |
| [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) | MIT | MP4 and M4A container for the video and AAC exports |
| [webm-muxer](https://github.com/Vanilagy/webm-muxer) | MIT | WebM container for the WebM video export |
| [gifenc](https://github.com/mattdesl/gifenc) | MIT | GIF encoding and colour quantization |

## Libraries downloaded at runtime (not bundled)

| Component | License | Use |
|---|---|---|
| [lamejs](https://github.com/zhuker/lamejs) 1.2.1 (a port of LAME), from cdn.jsdelivr.net | LGPL-3.0 | MP3 encoding, loaded only when MP3 export is chosen |
| Space Grotesk, Instrument Serif, Playfair Display, Bebas Neue (Google Fonts) | SIL Open Font License 1.1 | video titles, loaded only when chosen |

Magenta.js 1.23.1 depends on older packages with known advisories (protobufjs, minimist,
static-eval); they are only loaded when a neural feature is used.

## Models downloaded at runtime (not redistributed)

| Model | Source | License |
|---|---|---|
| MusicVAE `mel_chords`, ImprovRNN `chord_pitches_improv`, GrooVAE `groovae_2bar_humanize` | Google Magenta checkpoints (storage.googleapis.com/magentadata) | Apache-2.0 |
| MSI-Net saliency (TensorFlow.js) | Kroner et al., [alexanderkroner/saliency](https://github.com/alexanderkroner/saliency) (storage.googleapis.com/msi-net) | MIT |
| COCO-SSD (SSDLite MobileNet v2, TensorFlow.js) | [tensorflow/tfjs-models](https://github.com/tensorflow/tfjs-models) | Apache-2.0 |

## Samples downloaded at runtime (not redistributed)

| Samples | Source | License |
|---|---|---|
| General MIDI soundfonts (MusyngKite, FluidR3_GM), pre-rendered | [gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) | MIT (rendering); MusyngKite soundfont CC BY-SA 3.0, FluidR3_GM MIT |
| Splendid Grand Piano, electric pianos | [sfzinstruments](https://github.com/sfzinstruments), via smplr's sample hosts | see each repository |
| Drum machines, DrumAbuse, Mellotron, VCSL mallets | smplr's sample hosts (smpldsnds), [VCSL](https://github.com/sgossner/VCSL) (CC0) | see each source |

Audio produced with sampled instruments is subject to the sample licenses above; the
synthesized instruments (the fallback of every sampled one) are part of Lux Sonora.

## Research the app builds on

Itti, Koch and Niebur (1998), saliency model; Hou and Zhang (2007), spectral residual; Achanta
et al. (2009), frequency-tuned saliency; Kroner et al. (2020), MSI-Net; Roberts et al. (2018),
MusicVAE; Gillick et al. (2019), GrooVAE; Toussaint (2005), euclidean rhythms.
