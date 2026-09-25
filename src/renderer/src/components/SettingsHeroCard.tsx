/**
 * Neutral, offline-ready app identity card. Fork-specific promotions and
 * upstream external links are intentionally omitted.
 */
import { useEffect, useState } from 'react';
import { PixelButton } from './PixelButton';
import { DEFAULT_HERO, type HeroPayload } from '@shared/heroPayload';
import { manualDownloadUrl, pendingVersion, reduceStatus, type UpdateStatus } from '@shared/updateState';
import oqvianWordmark from '../assets/brand/oqvian-wordmark.jpg';

export function SettingsHeroCard() {
  const [version, setVersion] = useState<string | null>(null);
  // Starts on the compiled-in defaults, so there is no empty frame or spinner
  // while the fetch is in flight — it just fills in if anything changed.
  const [hero, setHero] = useState<HeroPayload>(DEFAULT_HERO);
  /** Whatever release the updater knows about, so the card can offer the
   *  manual download right where the version is shown. */
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    const off = window.cth.onUpdateStatus?.((next) => setStatus((prev) => reduceStatus(prev, next)));
    void window.cth.updateCurrent?.().then((cur) => {
      if (cur) setStatus((prev) => reduceStatus(prev, cur));
    }).catch(() => { /* push channel still works */ });
    return off;
  }, []);
  const pending = version ? pendingVersion(status, version) : null;
  const downloadManually = () => {
    if (!status) return;
    const url = manualDownloadUrl(status, window.cth.platform, window.cth.arch);
    if (url) void window.cth.updateOpenRelease(url);
  };

  useEffect(() => {
    let alive = true;
    window.cth.appInfo()
      .then((i) => { if (alive) setVersion(i.version); })
      .catch(() => { /* the card is still useful without it */ });
    window.cth.heroPayload()
      .then((r) => { if (alive) setHero(r.hero); })
      .catch(() => { /* defaults already rendered */ });
    return () => { alive = false; };
  }, []);

  const PLAN = hero.plan;
  const INK = 'var(--cth-ink-900)';
  const MONO = 'var(--cth-font-mono, monospace)';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: 'var(--cth-paper-100)',
      border: `2px solid ${INK}`
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14 }}>
        {/* Identity: name, the running version in plain sight, the plan. */}
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{
              fontFamily: 'var(--cth-font-display)', fontSize: 13, lineHeight: '20px', color: INK
            }}>OFFICE-X</span>
            {version && (
              <span style={{
                fontFamily: MONO, fontSize: 15, fontWeight: 700, color: INK
              }}>v{version}</span>
            )}
            <span style={{
              fontFamily: MONO, fontSize: 9, letterSpacing: '.12em', textTransform: 'uppercase',
              padding: '2px 7px', background: 'var(--cth-mint-light)',
              boxShadow: 'inset 0 0 0 1px var(--cth-mint)', color: INK
            }}>{PLAN.label}</span>
            {pending && (
              <>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--cth-ink-700)' }}>
                  v{pending} is out
                </span>
                <PixelButton variant="primary" size="sm" onClick={downloadManually}
                  title="Download the installer and replace the app yourself. Auto-update is in Updates below.">
                  download v{pending}
                </PixelButton>
              </>
            )}
          </div>
          <div style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.5, color: 'var(--cth-ink-700)', maxWidth: '64ch' }}>
            {PLAN.blurb}
          </div>
        </div>

        {/* A one-line notice (an incident, a migration heads-up), when set. */}
        {hero.notice && (
          <div style={{
            padding: '8px 10px', fontSize: 12, lineHeight: 1.5, color: INK,
            background: 'var(--cth-lemon-light)', border: `2px solid ${INK}`
          }}>{hero.notice}</div>
        )}

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          paddingTop: 10, borderTop: '1px solid var(--cth-ink-300)'
        }}>
          <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.08em', color: 'var(--cth-ink-700)' }}>
            A PRODUCT BY
          </span>
          <img src={oqvianWordmark} alt="OQVIAN — AI / Security / IT" style={{
            display: 'block', width: 176, maxWidth: '58%', height: 'auto', borderRadius: 3
          }} />
        </div>

      </div>
    </div>
  );
}
