# Umbra

Umbra is a macOS language-learning app for reading, listening and building vocabulary from your own material. It is a fork of [Lumen](https://github.com/LivingTwice/lumen), with Hebrew support, synced YouTube captions, and playback controls designed for studying podcasts and videos.

[Download Umbra for Apple silicon](https://github.com/raphaelbenjamin/umbra/releases/latest)

## What you can do

- Read in Hebrew with right-to-left layout and unpointed display, and look up words in the bundled Hebrew–English dictionary or the contextual AI dictionary.
- Import a YouTube episode as audio with captions, video with captions, or video transcribed by Whisper.
- Click the speed button to cycle through 1×, 1.5×, 2× and 0.75×. Turn on three-second arrow seeking in Reading settings.
- Right-click a learning word to mark it known, then right-click again to return it to Learning level 1. Playback rewinds 0.2 seconds when you resume a paused lesson.
- Bring vocabulary, study activity, and lessons from the original Lumen through **Settings → Backup → Import from original Lumen**.

## Install and update

Extract the Apple silicon download and place **Umbra.app** in Applications. Once Umbra is installed, use **Umbra → Check for Updates**. Umbra verifies update signatures before replacing the installed app. It uses the same library as earlier Lumen Hebrew and Lumen 2.0 builds, and keeps its backups separate from the original Lumen.

## Development

On Apple silicon, install Node.js, Rust, CMake and the Xcode command-line tools. Run `npm ci` and `npm run app:dev`, or build an app with `npm run app:build -- --bundles app`. See the [development guide](docs/umbra.md) for library migration, media import and test details.

Maintainers publish a release by updating the app version and pushing a matching `v*` tag. The macOS release workflow builds an app and signs the updater archive using the repository’s Umbra signing secret. Keep a separate secure copy of the private key for future releases.

Umbra is licensed under [GPL-3.0-or-later](LICENSE). The original Lumen project and its contributors are credited in the source.
