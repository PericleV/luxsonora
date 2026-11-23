# Five genres: specification (draft for review)

Lux Sonora keeps five genres. The others stay in the code, so a saved project still opens, but
they are hidden from the lists. Each genre below has its identity, the rules it is written by, what
the picture chooses inside it, and the checks that tell whether a piece is right. Every section
ends with what exists today and what changes.

Two findings from the measurements come first, because they apply to all five genres.

## 0. Common to all five

### 0.1 Why different pictures sound alike

Six very different pictures (night, pastel, dense texture, smooth gradient, warm, cool) were
composed in each genre and compared:

| What varies today | Measured over 6 pictures |
|---|---|
| Key | 6 different keys (good) |
| Tempo | up to 27 bpm apart in epic, 11 in lo-fi (good) |
| Melody register and density | clearly different (good) |
| Mode | **epic and synthwave: always natural minor** |
| Instruments | **identical in a genre** |
| Chord progression family | one per genre, only the order changes |
| Drum groove | one per genre |

The mode problem is a bug of mapping: the mode is picked from the picture's mood (brightness,
warmth, saturation), but real pictures rarely reach the ends of that scale, so the middle mode
always wins. **Change:** the mood is stretched to the full range before the choice (a fixed curve,
the same on every device), and each genre lists its modes with a weight.

The rest is a matter of design: each genre gets **two or three palettes, progression families and
grooves**, and the picture picks one of each (sections below). In the *Classic* mode the four core
tracks stay the same instruments as today (that is what Classic promises); the palettes apply to
*By genre* and *The picture chooses the band*. **To decide:** should Classic also follow the
palette the picture picks?

### 0.2 Tempo that fits the duration

The piece fits a whole number of bars into the length asked for, so the tempo moves in steps: 16
bpm at 15 s, 5 bpm at 45 s. Two pictures with slightly different energy get the same tempo.
**Change (to decide):** keep the tempo the picture asks for and let the length move by up to half a
bar (at most about 1.2 s at 100 bpm). The video and the exports take the real length.

### 0.3 What the picture chooses, in every genre

| Picture feature | Musical choice |
|---|---|
| Brightness, warmth, saturation (mood) | mode, major or minor colour of the progression family |
| Edges and entropy (energy) | tempo inside the genre's range, drum groove, density of the figures |
| Hue | key (as today) |
| Lines (HOG: straight, oriented) | rhythmic regularity: motor rhythm, ostinato, arpeggiator |
| Texture and grain | articulation (detached or legato), shaker/hats, vinyl |
| Depth and contrast | the arc: how far the climax rises above the start |
| Colour contrast between places | modulation and chromatic colour chords |
| Repetition in the picture | how often the main motif returns |

### 0.4 Sound checks that every genre must pass

Measured on rendered audio and on the score, for several pictures and durations:

- no clicks (the detector on the rendered mix: 0 at the end of notes, held sounds and pump);
- no track with fewer than 8 notes, no lone loud note;
- velocity follows the arc on every track (spread above 4 on each, measured);
- each instrument within its real range, the melody above the accompaniment;
- loudness per instrument calibrated (RMS at velocity 64 within 3 dB of its role's target);
- the music audit: clashes, stale bars, mud and pile-ups no higher than today.

---

## 1. Orchestral epic

**Identity.** Trailer and battle music: a driving string ostinato, low brass, choir, big
percussion, a sparse start that builds to a peak, a stop before the last hit, an ending on a held
chord. Heavy downbeats; the tempo is moderate, the energy comes from the subdivision.

| | Rule |
|---|---|
| Tempo | 84 to 132 bpm (calm pictures nearer 84, half-time feel; busy ones nearer 132) |
| Modes | natural minor (weight 3), Dorian (2), Phrygian (1, dark pictures), Lydian (1, only for the major "heroic" family) |
| Progression families | **Minor epic** i, ♭VI, ♭III, ♭VII (and i, ♭VI, ♭VII, i); **Heroic** I, ♭VII, IV, I or I, ♭VI, ♭VII, I (modal mixture); **Dark** i, ♭II, i, v (Phrygian) |
| Harmonic rhythm | one chord per bar, two per bar at the climax; a pedal tonic in the intro |
| Melody | horns or strings, wide steps (4ths, 5ths, octave leaps landing by step), long notes on strong beats; range a 10th to a 12th |
| Bass | contrabass and cello on the root, octave ostinato in eighths at the build |
| Figures | string ostinato in eighths (sixteenths at the climax), staccato; brass stabs on the downbeat of the climax |
| Percussion | taiko and toms on 1 and 3, cymbal swells into sections, timpani rolls before the climax; **no taiko on the last held chord** (done) |
| Form | intro (pedal, low strings) → build (ostinato enters, then brass) → climax (choir, full percussion) → stop of one beat → last hit and held chord |
| Mix | wide panning (strings left and right, brass centre-left), large hall reverb, choir behind |

**Palettes the picture chooses:** *Trailer* (horns, staccato strings, choir, taiko), *Heroic*
(trumpet lead, brass section, timpani, cymbals), *Dark* (cellos and low brass, male choir, toms).

**Today:** one palette, always natural minor, no stop before the end, cadence family [VI, III,
VII]. **Changes:** the three families and palettes, the stop-down, the heroic major family,
sixteenth ostinato at the climax.

## 2. Synthwave

**Identity.** 1980s synthesizer music: analog pads, a repeating arpeggio, a steady eighth or
sixteenth bass, gated drums with a big snare, a singing saw lead, nostalgic minor harmony, sidechain
pumping.

| | Rule |
|---|---|
| Tempo | 84 to 118 bpm (sources agree on 80 to 118; faster for darker pictures) |
| Modes | natural minor (3), Dorian (2), major (1, bright pastel pictures) |
| Progression families | **Night drive** i, ♭VI, ♭III, ♭VII; **Sunset** vi, IV, I, V; **Neon** i, ♭VII, ♭VI, ♭VII (four chords, looped) |
| Harmonic rhythm | one chord per bar, loops of four bars; the loop changes only at the climax |
| Melody | saw lead, simple and singable, many repeated notes and steps, sustained notes with vibrato; range an octave and a half |
| Bass | octave bass in eighths (calm) or sixteenths (busy), always on the root, ducked by the kick |
| Figures | arpeggiator in sixteenths following the chord (up; up and down when tense) |
| Drums | kick on every beat or 1 and 3, gated snare on 2 and 4, eighth hats; toms fill at section ends |
| Form | intro (pad and arpeggio) → bass enters → drums → lead → break (drums out) → last chorus with everything |
| Mix | chorus on the pads, gated reverb on the snare, sidechain pump on pad and bass, stereo delay on the lead |

**Palettes:** *Outrun* (saw lead, poly synth, octave bass, gated kit), *Dreamwave* (soft lead,
glassy pad, slower), *Darksynth* (detuned brass lead, distorted bass, harder kit).

**Today:** one palette, always minor, arpeggiator in Movement only where the accompaniment holds.
**Changes:** the three families, the break before the last section, gated snare reverb, the
sixteenth bass for busy pictures.

## 3. Classical and Baroque (one genre, two idioms)

**Identity.** Concert music written by the rules of tonal harmony. The picture picks the idiom:
lines that are straight and regular (strong HOG, grain) give **Baroque**, a continuous motor rhythm
over a walking continuo; smooth and open pictures give **Classical**, clear four and eight bar
phrases with a light accompaniment. The user can force either.

| | Baroque | Classical |
|---|---|---|
| Tempo | 76 to 116 bpm, steady | 60 to 132 bpm (adagio to allegro by energy) |
| Modes | major, minor (harmonic minor at cadences) | major, minor |
| Harmony | sequences: circle of fifths (vi, ii, V, I and the descending fifths chain), Monte, Fonte, Prinner; cadences with the dominant 7th | stock phrases: Romanesca or Do-Re-Mi opening, Prinner reply, Fonte in the middle, cadential 6/4 to V7 to I |
| Phrase | Fortspinnung: an opening idea, its sequence, a cadence | sentence (2 + 2 + 4) or period (antecedent on a half cadence, consequent on a full one) |
| Melody | violin or oboe, sixteenth figuration, sequence of the same figure a step lower | piano or violin, singable, appoggiaturas on strong beats |
| Bass | walking continuo in eighths (cello, harpsichord) | Alberti or broken chords in the left hand, bass on the beat |
| Texture | two real lines (melody and bass) plus figured harmony; imitation of the motif in the counter line | melody and accompaniment |
| Form | ritornello: theme, episodes with sequences, theme in the relative key, theme | small ternary: A (period), B (Fonte, dominant pedal), A |
| Percussion | none | none (timpani only at a grand cadence) |
| Mix | small room, harpsichord bright, strings close | larger hall, piano centre |

**Voice leading (both):** no parallel fifths or octaves between melody and bass, the leading tone
rises, the 7th of the chord falls (the audit already counts parallels; the target is lower than
today's 0.24 per minute).

**Palettes:** Baroque *Concerto* (violin, harpsichord, strings, cello) or *Organ* (organ, recorder);
Classical *Piano sonata* (piano alone, both hands) or *Quartet* (violin, viola, cello).

**Today:** two separate genres with the same harmony engine (I, IV, V, vi candidates), no
sequences, no real period structure. **Changes:** the schemata and sequences as progression
families, period and sentence phrasing, the walking continuo, the idiom chosen by the picture.

## 4. Lo-fi, with a meditation and ambient side

**Identity.** Warm, dusty, slow: jazz seventh chords on electric piano, swung boom-bap drums, a soft
bass, vinyl and tape. The calm side (calm pictures or by choice) drops the drums and becomes ambient
meditation: long tones, a drone, a pentatonic melody that breathes.

| | Lo-fi beat | Ambient side |
|---|---|---|
| Tempo | 70 to 90 bpm | 54 to 70 bpm, no pulse felt |
| Swing | sixteenths swung 54 to 60% | none |
| Modes | Dorian (3), natural minor (2), major (2), Mixolydian (1) | major pentatonic, Lydian, Dorian |
| Harmony | ii7, V7, Imaj7; Imaj7, vi7, ii7, V7; i7, iv7 (minor ninths); two to four chords looped | one or two chords, a held drone tonic, the chord changes every two bars or less |
| Chords | always sevenths or ninths, voiced close in the middle register | open fifths and added ninths, no thirds in the low register |
| Melody | short phrases, lots of space, blue notes in passing | few notes, long, pentatonic, rests between phrases |
| Bass | soft finger bass, root and fifth, behind the beat | drone or none |
| Drums | dusty kick on 1 and the "and" of 2, snare on 2 and 4 (laid back), swung hats, a shaker from the grain | none; a soft shaker or rain from the grain at most |
| Effects | vinyl crackle, tape wow, low-pass on the drums, sidechain light | long reverb, slow chorus, shimmer octave |
| Form | loop of 4 or 8 bars, variations every repeat, a break without drums | one slow swell, no climax, fades |

**Palettes:** *Study beats* (Wurlitzer, piano, finger bass, boom-bap), *Jazz café* (jazz guitar,
tenor sax, upright bass, brushes), *Meditation* (celesta or kalimba, warm pad, choir, drone),
*Nature* (nylon guitar, flute, harp).

**Today:** four separate genres (lo-fi, meditation, ambient, lo-fi nature) with overlapping
rules. **Changes:** one genre with the two sides chosen by the picture's energy (or by hand), the
four palettes, ninth chords as the rule.

## 5. Cinematic pop (the middle genre)

**Identity.** Between film and pop: piano chords that drive, a beat that grows from nothing,
strings that open up at the chorus, a hopeful melody. It borrows the build of the orchestral
genre, the loop and pulse of pop and synthwave, the warmth of lo-fi.

| | Rule |
|---|---|
| Tempo | 80 to 112 bpm (or half-time feel at 120 to 130) |
| Modes | major (3), natural minor (2), Mixolydian (1), Lydian (1, wonder) |
| Progression families | **Hopeful** I, V, vi, IV; **Bittersweet** vi, IV, I, V; **Lift** IV, I, V, vi (and IV, V, vi at the build); a borrowed ♭VI or iv for colour at the climax |
| Harmonic rhythm | one chord per bar in the verse, two per bar into the chorus |
| Melody | piano or voice-like lead, stepwise verse in the low-middle register, the chorus a 4th to an octave higher |
| Bass | sustained root in the verse, eighth pulse in the chorus |
| Figures | driving piano eighths, a string countermelody at the chorus, a harp or celesta arpeggio in the intro |
| Drums | none in the intro; a soft kick and claps in the verse; full kit with toms and a cymbal swell in the chorus |
| Form | intro (piano) → verse → build (the beat enters, risers) → chorus (strings, full drums) → breakdown → final chorus a step up |
| Mix | piano wide, strings wide and lush, moderate reverb, light sidechain on the pad |

**Palettes:** *Piano anthem* (piano, strings, soft kit), *Indie* (clean guitar, piano, synth
strings, claps), *Orchestral pop* (piano, full strings, horns, timpani).

**Today:** pop and cinematic exist separately (pop: guitar and piano, loop I, V, vi, IV;
cinematic: harp, strings, no drums). **Changes:** one genre built from both, with the verse,
build and chorus arc and the key change for the last chorus.

---

## 6. Order of work

1. The common changes (0.1 mood stretch and weighted modes, 0.2 tempo, loudness calibration).
2. Genre by genre, in this order: Orchestral epic, Synthwave, Lo-fi, Cinematic pop, Classical and
   Baroque (the last needs the most new harmony: sequences and schemata).
3. For each genre: its families, palettes and grooves, its tests (the rules in the tables), the
   audit and the click check, then a listening review with you before the next one.
4. Hide the other genres (they still open in saved projects).

## Sources

- Trailer and epic music: [Game Developer, epic music](https://www.gamedeveloper.com/audio/getting-making-game-music-that-fits---classic-genre-series---epic-music), [Epicomposer, trailer tips](https://epicomposer.com/trailer-music-production-tips/), [Hooktheory, cinematic progressions](https://www.hooktheory.com/blog/cinematic-chord-progressions/), [LANDR, cinematic progressions](https://blog.landr.com/cinematic-chord-progressions)
- Synthwave: [EDMProd](https://www.edmprod.com/how-to-make-synthwave/), [MODE Audio](https://modeaudio.com/magazine/synthwave-5-production-essentials), [MusicRadar](https://www.musicradar.com/how-to/how-to-make-an-80s-style-synth-track-in-your-daw), [Native Instruments](https://blog.native-instruments.com/synthwave/)
- Lo-fi: [Native Instruments](https://blog.native-instruments.com/how-to-make-lofi-music/), [Splice](https://splice.com/blog/lo-fi-hip-hop-beat-10-minutes/), [Reason Studios](https://www.reasonstudios.com/news/post/how-make-lofi-hip-hop-beats), [Mastering The Mix](https://www.masteringthemix.com/blogs/learn/how-to-make-lo-fi-hip-hop)
- Ambient and relaxation: [Signal Sounds](https://www.signalsounds.com/blog/making-ambient-music-the-science-behind-the-calm) (the 60 bpm claim there is not verified)
- Baroque and classical: [Wikipedia, Baroque music](https://en.wikipedia.org/wiki/Baroque_music), [Open Music Theory, galant schemas](https://viva.pressbooks.pub/openmusictheory/chapter/galant-schemas/), [Wikipedia, Galant schemata](https://en.wikipedia.org/wiki/Galant_Schemata) (Gjerdingen, *Music in the Galant Style*, 2007), Caplin, *Classical Form* (1998) for sentence and period
- Cinematic and orchestral pop: [Shockwave-Sound, cinematic pop](https://shockwave-sound.com/browse/genre/cinematic-pop/stock-music/order-relevance/standard/50/5); the genre is a loose label, so its rules here are a synthesis of pop and film practice
