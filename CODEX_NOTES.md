# OFFICE-X two-computer build notes

Checked on 2026-09-27 from `officex/shared-offices` at `699981e7` (clean source tree before this note). Host Node: `v26.10.0`.

## Current-HEAD checks

- `npm run typecheck` — passed (Node and web TypeScript checks).
- `npm run test:focused` — passed: 909 tests, 0 failures.
- `npm run relay:test` under Node 26 — passed: 4 tests, 0 failures, including a real loopback relay reservation and relayed peer connection.
- No test failures or source fixes were needed.

`relay/package.json` currently declares Node `>=22 <23`. The Node 26 pass is evidence that the range **may** be relaxed, but four smoke tests on one host do not establish supported deployment compatibility. Recheck installation and long-running/public relay behavior on Node 26 (and ideally CI) before changing `engines`. It was left unchanged.

## Linux build to transfer

- `npm run dist:linux` — passed; Electron native modules rebuilt and electron-builder produced an x86-64 AppImage.
- Artifact: `/home/ahnaf/Documents/Documents/OQVIAN/OFFICE-X/dist/OFFICE-X-0.4.6-linux-x86_64.AppImage`
- Size: 198,593,485 bytes.
- SHA-256: `8e655457afd71b43011224ea02af171969ac4d86fd3ea0e3d6b6b74ddd166a03`
- Send the AppImage and this hash to the Bazzite teammate. On their computer, run `sha256sum OFFICE-X-0.4.6-linux-x86_64.AppImage` and compare before launching.

## Bazzite KDE teammate steps

1. Run the AppImage from the **host KDE desktop**, not a container: `chmod +x ./OFFICE-X-0.4.6-linux-x86_64.AppImage` then `./OFFICE-X-0.4.6-linux-x86_64.AppImage`. Bazzite documents AppImage use and its current image includes `fuse-libs`; package layering should normally be unnecessary. If mounting fails, check `rpm -q fuse-libs` and `test -e /dev/fuse`; try `./OFFICE-X-0.4.6-linux-x86_64.AppImage --appimage-extract-and-run`. Treat host package layering as a last resort on Fedora Atomic, followed by a reboot.
2. In KDE **System Settings → Security & Privacy → KDE Wallet**, enable the wallet subsystem and **Use KWallet for the Secret Service interface**. Create/unlock the wallet in KWallet Manager if prompted. Confirm `busctl --user status org.freedesktop.secrets` succeeds. If `secret-tool` is installed, optionally probe store/lookup/clear with `printf 'probe' | secret-tool store --label='OFFICE-X probe' app officex-probe`, `secret-tool lookup app officex-probe`, then `secret-tool clear app officex-probe`. Log out/in if a newly enabled service is not visible.
3. Open **Shared Office** and create this device's invite. This is the required app-level keyring check: `src/main/integrations.ts` rejects Electron `safeStorage` backends `basic_text` and `unknown`, so a visible Secret Service alone does not prove identity creation works.
4. For the actual two-computer test, both devices need a **currently reachable** self-hosted relay multiaddr ending in `/p2p/<relay PeerID>`; a Cloudflare quick-tunnel hostname can expire. Exchange and verify both invite fingerprints out of band, pin each other, then test presence, task approval, delegated prompt, opted-in terminal output/input, and revocation. This acceptance remains open.

Sources: [Bazzite AppImage guide](https://docs.bazzite.gg/Installing_and_Managing_Software/AppImage/), [Bazzite image definition](https://github.com/ublue-os/bazzite/blob/main/Containerfile), [AppImage FUSE troubleshooting](https://docs.appimage.org/user-guide/troubleshooting/fuse.html), [Bazzite rpm-ostree guidance](https://docs.bazzite.gg/Installing_and_Managing_Software/rpm-ostree/), [KDE KWallet](https://github.com/KDE/kwallet), [Fedora kf6-kwallet package](https://packages.fedoraproject.org/pkgs/kf6-kwallet/kf6-kwallet/fedora-rawhide.html), [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

## 2026-09-27 feature-plan progress: local voice engines

- Added `src/main/voice/stt.ts` with exactly `transcribe(pcm16kMono: Int16Array): Promise<string>` and `src/main/voice/tts.ts` with `synthesize(text, voice?): Promise<{ wav: Buffer }>` and `listVoices(): string[]`. The default offline voice is `en_US-ljspeech-medium`.
- `src/main/voice/assets.ts` downloads pinned whisper.cpp v1.9.2 / Piper 2023.11.14-2 binaries and base.en / LJ Speech models into Electron userData on first use, verifies SHA-256 before installation, and emits `voice:download-progress` from main. No paid API key or installer-bundled model. `src/main/voice/process.ts` runs the binaries without a shell; `wav.ts` handles PCM/WAV.
- Added fast asset/CLI/WAV tests and a 1.7-second spoken fixture. Typecheck passed; all 6 targeted tests passed with the real Linux whisper.cpp and Piper binaries supplied through test-only environment variables. The normal suite also runs without downloads and skips only the two optional real-binary probes.
- Claude's Phase 2 meeting UI still needs a preload/IPC bridge to call these engines and listen to progress. Next Codex step: wire that bridge without editing `components/meeting/`, then move to Phase 3 floors and Phase 4 model catalog.
