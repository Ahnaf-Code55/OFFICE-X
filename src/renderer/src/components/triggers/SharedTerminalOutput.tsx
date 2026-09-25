import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useTranslation } from 'react-i18next';

/** A read-only live mirror. Output is never persisted and starts at subscription time. */
export function SharedTerminalOutput({ memberId, agentId }: { memberId: string; agentId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const terminal = new Terminal({
      cols: 90, rows: 18, scrollback: 1500, disableStdin: true,
      convertEol: false, allowProposedApi: false, cursorBlink: false,
      theme: { background: '#17131d', foreground: '#f4ebd0', cursor: '#e7b95c' }
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    requestAnimationFrame(() => { try { fit.fit(); } catch { /* detached view */ } });
    const observer = new ResizeObserver(() => { try { fit.fit(); } catch { /* detached view */ } });
    observer.observe(host);
    terminal.writeln(t('teamMembers.streamStartsNow'));
    const unsubscribe = window.cth.onOrgTerminalOutput((event) => {
      if (event.memberId !== memberId || event.agentId !== agentId) return;
      if (event.gap) terminal.writeln('\r\n[Some terminal output was dropped during network backpressure]\r\n');
      terminal.write(event.output);
    });
    return () => { observer.disconnect(); unsubscribe(); terminal.dispose(); };
  }, [memberId, agentId, t]);

  return <div ref={hostRef} aria-label={t('teamMembers.terminalOutputLabel')} style={{ minHeight: 280, height: 280, padding: 6, background: '#17131d', borderRadius: 6, overflow: 'hidden' }} />;
}
