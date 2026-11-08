<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-white.svg">
    <img src="docs/logo.svg" alt="Lux Sonora logo" width="120">
  </picture>
</p>

# Lux Sonora

**Image sonification: from image to sound.**

**Try it:** [periclev.github.io/luxsonora](https://periclev.github.io/luxsonora/)

Every image holds a story. Part of it is in plain sight, but most of it waits in the light, in the colours and in the places where the eye lingers a little longer than it meant to.

Lux Sonora uses image analysis algorithms to find that story and give it a voice. It follows the eye as it wanders through a picture, and each place the eye rests becomes a moment in the music. Where the gaze begins, where it returns and where it finally settles shape the song from its first note to its last.

What you see becomes something you can hear. And because the same image always tells the same story, every note leads back to the part of the picture it came from.

- **Sixteen styles with their genre rules:** Ambient, Minimal, Lo-fi hip hop, Classical, Cinematic, Movie score, Orchestral epic, Jazz, Bossa nova, Electronic, Synthwave, Pop, Rock, Metal, Blues and Funk: chord grid, drum phrases, articulations, transitions.
- **Where the eye goes:** nine placement methods, from classic saliency (region contrast, spectral residual, frequency-tuned, Itti-Koch, details, composition, scan) to neural ones (COCO-SSD objects, MSI-Net learned saliency). Generate the points automatically, or place them yourself and give each one a role: calm, build, climax or release.
- **A story, not a sequence:** a dramatic arc (introduction, development, climax, resolution), passages that follow the path between two places, continuous transitions between regions, an orchestration chosen from the image, and optional neural melodies (Magenta MusicVAE "Story", ImprovRNN "Improvise") and grooves (GrooVAE).
- **Instruments:** synthesizers plus about 250 sampled instruments (General MIDI soundfonts, Steinway, electric pianos, Mellotron, mallets) and 225 drum kits, with a searchable picker that lets you listen first.
- **Images:** PNG, JPEG, WebP, GIF, BMP, AVIF and TIFF up to 300 MP, including 16-bit and floating-point SEM and TEM data.
- **Export:** audio as WAV (16 or 24-bit), MP3 or M4A, normalized to −14 LUFS; MIDI (with timbre automation); all parameters; a **recipe** that lets anyone make the same piece again (the image, every setting, the neural results and a check); and a **video** (MP4, WebM, GIF or a PNG poster) at the image's own size, with the gaze path, the places, their labels and effects drawn in time with the music and reacting to the sound: a smoothed camera, 11 line styles, colour grades, fonts, an end card and saved looks, previewed live on the stage.

Runs entirely in the browser: the analysis happens on your device, and the build is a single static file.

## Running

```bash
npm install
npm run dev      # local development server
npm test         # tests
npm run build    # dist/index.html: one static file
npm run audit:music   # note-by-note harmony report for every style
```

`dist/index.html` runs on GitHub Pages, as a claude.ai artifact or straight from disk. Sampled instruments and neural models are downloaded when first used; without a network the synthesized instruments and the classic algorithms still make the whole piece.

## Publishing

Every push to `main` runs the tests, builds `dist/` and publishes it with GitHub Pages (`.github/workflows/pages.yml`). In the repository settings, under **Pages**, set the source to **GitHub Actions** once. The build uses relative paths, so it works at `https://periclev.github.io/luxsonora/` or any other address.

## Documentation

- [docs/documentation.md](docs/documentation.md): how it works, every formula and rule
- [docs/ROADMAP.md](docs/ROADMAP.md): decisions and plan
- [docs/RESEARCH.md](docs/RESEARCH.md): similar software and building blocks

## Structure

- `src/core/`: pure core without DOM: analysis, saliency and placement, gaze path, dramatic arc, theory and genre rules, rhythm, accompaniment patterns, passages, orchestration, timbre, composition
- `src/ml/`: neural models (Magenta melodies and groove, COCO-SSD and MSI-Net placement)
- `src/audio/`: Web Audio engine, synthesizers, sampled instruments
- `src/export/`: MIDI, WAV, MP3, M4A, ZIP, video (frames, paths, look, sound analysis, labels)
- `src/ui/`: interface
- `legacy/sonificare.html`: the original prototype, reference for the equivalence test

## Contributing

Issues and pull requests are welcome. Please keep the core deterministic (no unseeded randomness, no `Date.now()` in the music), add a test for new behaviour (`npm test`), and document new rules in `docs/documentation.md`.

## Licence

MIT, see [LICENSE](LICENSE). Third-party libraries, models and sample sets keep their own licences: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Author

Developed by Pericle. If you like it, please follow me on Instagram: [@pericle_v](https://www.instagram.com/pericle_v/).
