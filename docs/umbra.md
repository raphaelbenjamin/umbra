# Umbra development guide

The desktop app uses the name **Umbra**, bundle identifier **`com.raphaelbenjamin.umbra`**, and executable **`umbra`**. GitHub builds the signed macOS updater. Local development builds use ad hoc signing. Some dictionaries and models are downloaded from upstream Lumen releases.

## Build and verify on Apple silicon

Install Node.js, Rust, CMake and the Apple developer tools. From the fork checkout run:

```sh
npm ci
npm run build
npm run app:build -- --bundles app
```

The bundle is at `src-tauri/target/release/bundle/macos/Umbra.app`. Before opening it, inspect its identifier:

```sh
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' \
  'src-tauri/target/release/bundle/macos/Umbra.app/Contents/Info.plist'
```

Expect `com.raphaelbenjamin.umbra`. A fresh desktop installation stores its library under that identifier. An upgrade opens the previous Umbra library in its existing `com.raphaelbenjamin.lumenhebrew` directory so that media paths and progress remain valid. New backup folders are named `Umbra`, and existing backups can still be opened in their previous folder. The iOS bundle retains its original identifier to preserve its app container.

For a browser-only preview, run `npm run dev` and open `http://localhost:1428`. The preview uses a separate browser storage key and a mock backend.

## Reading and transcription smoke test

1. Choose Hebrew in the language picker. Import this sample as text: `📖 שָׁלוֹם־עוֹלָם! Today: 42.\nשלום עולם.`
2. Confirm that the reader flows right to left and displays both versions of the word as `שלום`. Save a vocabulary status on one occurrence and confirm that it also appears on the other. Reopen the lesson to check persistence.
3. In transcription settings download Whisper Large v3 Turbo. Select Hebrew, then use Import → Audio for a local recording or Import → Link for a podcast episode or RSS feed. Check that the transcript contains Hebrew. During playback, compare the highlighted word with what you hear. Click individual words to check seek positions, especially around pauses and maqaf.
4. Run `cargo test --manifest-path src-tauri/Cargo.toml --lib`. The Hebrew timing test uses fixed Whisper-style timestamps to check pointed text, maqaf and UTF-16 offsets after an emoji. A recording is needed to assess recognition and timing accuracy.

The Whisper executable was tested on a [2.58-second Hebrew recording by Ijon](https://commons.wikimedia.org/wiki/File:He-Q4249304-אברהם_שלום_פרידברג-Ijon.ogg) using multilingual Whisper Tiny on the CPU. It returned four Hebrew tokens with ordered timestamps from 0.37 to 2.37 seconds. It misspelled parts of the name. The check verified timestamp structure and bounds.

## Bring over progress from the original Mac app

In Umbra, open **Settings → Backup → Import from original Lumen**. The import merges vocabulary, lesson reading and playback positions, study activity and playlists from the original Mac database into this app. You can choose whether to copy audio, video and covers. The fork makes a local safety snapshot before merging. Account settings and AI conversations stay in their original app. The libraries and cloud backups stay separate, so subsequent progress is independent.

## Playback and YouTube imports

Click the media speed button to cycle from 1× to 1.5× to 2× to 0.75× and back to 1×. Text-to-speech uses its existing speed controls.

Paste a single YouTube URL in **Import → Link** and choose **The video, transcribed** for Whisper, **Audio and YouTube captions** for audio only, or **Video and YouTube captions** for the picture and sound. The video choices offer a preferred resolution of 720p or 1080p. Caption imports use a track for the active study language when available and skip Whisper. They use caption segment timestamps when available and estimate word timing within segments. If the track is unavailable, choose local transcription.

The dictionary shows plausible prefix analyses alongside exact matches. When `בשנה` is followed by a number or a phrase like `שעברה`, the `ב־ + שנה` reading appears first. The clicked word and its saved vocabulary status stay the same.

## How the fork fits upstream

- React defines the language picker and uses the existing RTL reader and page navigation. Rust uses the existing Unicode word boundaries. The reader, video subtitles and dictionary panel hide niqqud and cantillation. Stored text and UTF-16 offsets retain the original marks. Hebrew vocabulary keys strip these marks so pointed and unpointed forms share a status. Maqaf separates words. Attached Hebrew prefixes and suffixes stay with the surface word for known-word tracking. Hebrew geresh and gershayim share lookup keys with their keyboard equivalents.
- Tauri resolves the application-specific data root. SQLite, media, model and dictionary caches, settings, and progress use that root. Backups use a separate folder name. The SQLite schema stays compatible with upstream development.
- The transcription pipeline passes `he` to multilingual Whisper. The current Qwen3-ASR and Parakeet language gates already exclude Hebrew. Whisper supplies both text and timestamps. The existing timestamp alignment uses the same word keys as the reader.
- The Wiktionary build tool can select Hebrew and generate format-2 lookup keys. A one-entry fixture produced a SQLite dictionary with the stored headword `שָׁלוֹם` and lookup key `שלום`. Kaikki publishes [structured Hebrew data extracted from English Wiktionary](https://kaikki.org/dictionary/Hebrew/index.html). The app bundles 12,435 Hebrew–English entries and 125,560 form links. Exact headwords and attested forms take precedence, followed by common attached-prefix lookup. The dictionary uses English definitions in both interface languages. Hebrew uses the existing contextual AI dictionary with Hebrew-specific instructions about unpointed words and prefixes. AI response quality still needs evaluation on podcast vocabulary.
- Hebrew uses the system speech path. A Web Speech voice must be available as `he` or legacy `iw`. Apple lists [Hebrew (Israel) for accessibility speech features](https://www.apple.com/macos/feature-availability/), but voice exposure in the Tauri webview needs a runtime check. Hebrew is outside the bundled Supertonic language list. If the webview exposes no suitable voice, the next local option on macOS is a native system speech bridge.
