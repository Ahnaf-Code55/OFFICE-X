# OFFICE-X release checklist

Run this against the exact commit and version intended for release.

## Before tagging

- [ ] Confirm `package.json`, `RELEASE.md`, and `build/release-notes.md` show the same version.
- [ ] Review the source diff and confirm the OFFICE-X app logo remains in the app and the OQVIAN
  company mark remains separate.
- [ ] Confirm `npm run check:links` passes and CI is green for the release commit.
- [ ] Build and launch the target platform package. Check startup, settings, local agent controls,
  and updater metadata.
- [ ] Exercise reciprocal invite pinning, presence, task approval, delegated prompts, full-control
  terminal input, output opt-in, access downgrade, and member revocation between two devices.
- [ ] Verify at least one shared connection route end to end: a reachable direct TCP route or a
  configured Circuit Relay v2 host. Test self-hosted relay deployment separately from the app build.
- [ ] If managed relay is advertised as available, confirm its production endpoint, TLS path,
  capacity, and monitoring are deployed; configure the `OFFICE_X_MANAGED_RELAY_MULTIADDR`
  repository variable with its public multiaddr and Peer ID before building. The repository does
  not provide a live OQVIAN managed endpoint by itself.
- [ ] Check that release assets include the platform installers and `SHA256SUMS.txt`.

## Publishing

- [ ] Publish from the OFFICE-X repository only; do not push or tag the upstream Munder Difflin
  repository.
- [ ] Review the generated GitHub Release page and confirm its title, notes, and assets identify
  OFFICE-X.
- [ ] Record the published version and artifact checksums in the project status notes.
