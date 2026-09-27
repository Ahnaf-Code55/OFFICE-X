import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store/store';
import { ORG_CONNECTION_MODES, PEER_CONTROL_LEVELS, type OrgConnectionMode, type OrgTriggerConfig, type TriggerMode } from '@shared/triggers';
import type { TeamMemberInvite, TeamMemberSummary } from '@shared/teamProtocol';
import type { TeamPresenceSnapshot } from '@shared/teamPresence';
import { getOrgTrigger, setOrgTrigger as persistOrgTrigger } from './api';
import { Callout, Field, Hint, ModePicker, Toggle } from './ui';
import { PixelButton } from '../PixelButton';
import { SharedTerminalOutput } from './SharedTerminalOutput';

/**
 * SHARED OFFICE — local identity, presence transport and trusted teammate permissions.
 *
 * Renders off the store mirror that Settings → Connections also renders off, and
 * follows the same mirror-then-persist rule: typing the key updates the mirror
 * (so Settings stays live) and commits on blur; the toggle and the trust mode
 * persist on the spot.
 */
export function OrgSection({ onSummary }: { onSummary?: (s: string) => void }) {
  const { t } = useTranslation();
  const cfg = useStore((s) => s.orgTrigger);
  const localAgents = useStore((s) => s.agents);
  const mirror = useStore((s) => s.setOrgTrigger);
  const [teamInviteText, setTeamInviteText] = useState('');
  const [teamInvite, setTeamInvite] = useState<TeamMemberInvite | null>(null);
  const [fingerprintConfirmation, setFingerprintConfirmation] = useState('');
  const [teamMembers, setTeamMembers] = useState<TeamMemberSummary[]>([]);
  const [remotePresence, setRemotePresence] = useState<TeamPresenceSnapshot>([]);
  const [requestMemberId, setRequestMemberId] = useState('');
  const [requestTitle, setRequestTitle] = useState('');
  const [requestMessage, setRequestMessage] = useState('');
  const [remoteAgentKey, setRemoteAgentKey] = useState('');
  const [remotePrompt, setRemotePrompt] = useState('');
  const [remoteTerminalInput, setRemoteTerminalInput] = useState('');
  const [teamNote, setTeamNote] = useState('');
  const [teamBusy, setTeamBusy] = useState(false);
  const [transportStatus, setTransportStatus] = useState<{ running: boolean; connectionConfigured: boolean; peerId?: string; error?: string }>({ running: false, connectionConfigured: false });
  const [terminalShares, setTerminalShares] = useState<Record<string, string[]>>({});

  useEffect(() => {
    // Only when the mirror looks unseeded — adopting unconditionally could
    // clobber a key being typed in Settings this second.
    const hasSharedOfficeSettings = (value: OrgTriggerConfig) => Boolean(value.apiKeySet || value.enabled
      || value.officeId || value.deviceId || value.displayName || value.managedRelayEndpoint
      || value.selfHostedEndpoint || value.peerToPeerEndpoint);
    if (hasSharedOfficeSettings(useStore.getState().orgTrigger)) return;
    void getOrgTrigger().then((c) => {
      if (c && !hasSharedOfficeSettings(useStore.getState().orgTrigger)) mirror(c);
    });
  }, [mirror]);

  useEffect(() => {
    onSummary?.(cfg.enabled ? t('common.on') : t('common.off'));
  }, [cfg, onSummary, t]);

  const refreshTeamMembers = async () => {
    try { setTeamMembers(await window.cth.listOrgMembers()); }
    catch { setTeamMembers([]); }
  };

  useEffect(() => { void refreshTeamMembers(); }, [cfg.officeId]);

  useEffect(() => {
    let alive = true;
    void Promise.all(teamMembers.map(async (member) => [member.memberId, await window.cth.getOrgTerminalShares(member.memberId)] as const))
      .then((entries) => { if (alive) setTerminalShares(Object.fromEntries(entries)); })
      .catch(() => { if (alive) setTerminalShares({}); });
    return () => { alive = false; };
  }, [teamMembers, cfg.officeId]);

  useEffect(() => {
    let alive = true;
    const refresh = () => { void window.cth.getOrgPresence().then((peers) => { if (alive) setRemotePresence(peers); }); };
    const unsubscribe = window.cth.onOrgPresence((peers) => { if (alive) setRemotePresence(peers); });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { alive = false; clearInterval(timer); unsubscribe(); };
  }, []);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void window.cth.getOrgTransportStatus().then((status) => { if (alive) setTransportStatus(status); });
    };
    refresh();
    const timer = cfg.enabled ? setInterval(refresh, 2500) : undefined;
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [cfg.enabled, cfg.connectionMode, cfg.managedRelayEndpoint, cfg.selfHostedEndpoint, cfg.peerToPeerEndpoint, cfg.officeId]);

  const apply = (next: OrgTriggerConfig, persist = true) => {
    mirror(next);
    if (persist) persistOrgTrigger(next);
  };

  const connectionStatusKey = cfg.connectionMode === 'self-hosted'
    ? (transportStatus.connectionConfigured || cfg.selfHostedEndpoint.trim() ? 'selfHostedConfigured' : 'selfHostedMissing')
    : cfg.connectionMode === 'managed-relay'
      ? (transportStatus.connectionConfigured || cfg.managedRelayEndpoint.trim() ? 'managedRelayConfigured' : 'managedRelay')
      : 'peerToPeer';
  const connectionStatus = cfg.enabled
    ? (transportStatus.running ? t('orgSection.connectionStatus.running')
      : transportStatus.error ? t('orgSection.connectionStatus.error')
        : t('orgSection.connectionStatus.starting'))
    : t(`orgSection.connectionStatus.${connectionStatusKey}`);

  const exportTeamInvite = async () => {
    setTeamBusy(true); setTeamNote('');
    try {
      const identity = await window.cth.getOrgIdentity();
      if (!identity.ok || !identity.deviceId || !identity.signingPublicKey || !identity.encryptionPublicKey) {
        throw new Error(identity.error ?? t('teamMembers.identityUnavailable'));
      }
      let officeId = identity.officeId;
      if (!officeId) {
        const created = await window.cth.setOrgOfficeId(`office-${window.crypto.randomUUID().replaceAll('-', '')}`);
        if (!created.ok || !created.officeId) throw new Error(created.error ?? t('teamMembers.officeError'));
        officeId = created.officeId;
        mirror({ ...useStore.getState().orgTrigger, officeId });
      }
      const invite = {
        version: 1 as const,
        officeId,
        memberId: identity.deviceId,
        displayName: identity.displayName?.trim() || t('teamMembers.defaultName'),
        signingPublicKey: identity.signingPublicKey,
        encryptionPublicKey: identity.encryptionPublicKey,
        fingerprint: identity.fingerprint ?? '',
        ...(identity.directEndpoint ? { directEndpoint: identity.directEndpoint } : {})
      } satisfies TeamMemberInvite;
      setTeamInviteText(JSON.stringify(invite, null, 2));
      setTeamNote(t('teamMembers.inviteReady'));
    } catch (error) {
      setTeamNote(error instanceof Error ? error.message : String(error));
    } finally { setTeamBusy(false); }
  };

  const previewTeamInvite = async () => {
    setTeamBusy(true); setTeamNote(''); setTeamInvite(null); setFingerprintConfirmation('');
    try {
      const parsed: unknown = JSON.parse(teamInviteText);
      const result = await window.cth.previewOrgInvite(parsed);
      if (!result.ok || !result.invite) throw new Error(result.error ?? t('teamMembers.invalidInvite'));
      const identity = await window.cth.getOrgIdentity();
      if (!identity.ok) throw new Error(identity.error ?? t('teamMembers.identityUnavailable'));
      if (identity.deviceId === result.invite.memberId) throw new Error(t('teamMembers.cannotAddSelf'));
      if (identity.officeId && identity.officeId !== result.invite.officeId) {
        // Both sides clicked "Create my invite" first, so each made its own office.
        // Join theirs instead; main refuses if this device already trusts anyone.
        const joined = await window.cth.setOrgOfficeId(result.invite.officeId);
        if (!joined.ok || !joined.officeId) throw new Error(joined.error ?? t('teamMembers.officeMismatch'));
        mirror({ ...useStore.getState().orgTrigger, officeId: joined.officeId });
      }
      setTeamInvite(result.invite);
    } catch (error) {
      setTeamNote(error instanceof Error ? error.message : t('teamMembers.invalidInvite'));
    } finally { setTeamBusy(false); }
  };

  const copyTeamInvite = async () => {
    try {
      await navigator.clipboard.writeText(teamInviteText);
      setTeamNote(t('teamMembers.inviteCopied'));
    } catch {
      setTeamNote(t('teamMembers.copyFailed'));
    }
  };

  const pinTeamInvite = async () => {
    if (!teamInvite) return;
    setTeamBusy(true); setTeamNote('');
    try {
      const result = await window.cth.pinOrgMember({
        ...teamInvite,
        controlLevel: cfg.defaultControlLevel,
        fingerprintConfirmation
      });
      if (!result.ok) throw new Error(result.error ?? t('teamMembers.pinFailed'));
      if (!cfg.officeId) mirror({ ...useStore.getState().orgTrigger, officeId: teamInvite.officeId });
      setTeamInvite(null); setTeamInviteText(''); setFingerprintConfirmation('');
      setTeamNote(t('teamMembers.memberAdded'));
      await refreshTeamMembers();
    } catch (error) {
      setTeamNote(error instanceof Error ? error.message : String(error));
    } finally { setTeamBusy(false); }
  };

  const changeMemberAccess = async (member: TeamMemberSummary, controlLevel: TeamMemberSummary['controlLevel']) => {
    setTeamBusy(true); setTeamNote('');
    try {
      const result = await window.cth.setOrgMemberControl(member.memberId, controlLevel);
      if (!result.ok) throw new Error(result.error ?? t('teamMembers.accessUpdateFailed'));
      await refreshTeamMembers();
    } catch (error) {
      setTeamNote(error instanceof Error ? error.message : String(error));
    } finally { setTeamBusy(false); }
  };

  const sendTaskRequest = async () => {
    if (!requestMemberId || !requestTitle.trim() || !requestMessage.trim()) return;
    setTeamBusy(true); setTeamNote('');
    try {
      const result = await window.cth.sendOrgTaskRequest(requestMemberId, requestTitle.trim(), requestMessage.trim());
      if (!result.ok) throw new Error(result.error ?? t('teamMembers.sendFailed'));
      setRequestTitle(''); setRequestMessage(''); setTeamNote(t('teamMembers.sent'));
    } catch (error) { setTeamNote(error instanceof Error ? error.message : String(error)); }
    finally { setTeamBusy(false); }
  };

  const sendRemotePrompt = async () => {
    const [memberId, agentId] = remoteAgentKey.split('\u0000');
    if (!memberId || !agentId || !remotePrompt.trim()) return;
    setTeamBusy(true); setTeamNote('');
    try {
      const result = await window.cth.sendOrgAgentPrompt(memberId, agentId, remotePrompt.trim());
      if (!result.ok) throw new Error(result.error ?? t('teamMembers.sendFailed'));
      setRemotePrompt(''); setTeamNote(t('teamMembers.sent'));
    } catch (error) { setTeamNote(error instanceof Error ? error.message : String(error)); }
    finally { setTeamBusy(false); }
  };

  const sendRemoteTerminalInput = async () => {
    const [memberId, agentId] = remoteAgentKey.split('\u0000');
    if (!memberId || !agentId || !remoteTerminalInput) return;
    setTeamBusy(true); setTeamNote('');
    try {
      const result = await window.cth.sendOrgTerminalInput(memberId, agentId, `${remoteTerminalInput}\r`);
      if (!result.ok) throw new Error(result.error ?? t('teamMembers.sendFailed'));
      setRemoteTerminalInput(''); setTeamNote(t('teamMembers.sent'));
    } catch (error) { setTeamNote(error instanceof Error ? error.message : String(error)); }
    finally { setTeamBusy(false); }
  };

  const setTerminalShare = async (memberId: string, agentId: string, enabled: boolean) => {
    setTeamBusy(true); setTeamNote('');
    try {
      const result = await window.cth.setOrgTerminalShare(memberId, agentId, enabled);
      if (!result.ok) throw new Error(result.error ?? t('teamMembers.sendFailed'));
      setTerminalShares((current) => ({
        ...current,
        [memberId]: enabled
          ? [...new Set([...(current[memberId] ?? []), agentId])]
          : (current[memberId] ?? []).filter((id) => id !== agentId)
      }));
    } catch (error) { setTeamNote(error instanceof Error ? error.message : String(error)); }
    finally { setTeamBusy(false); }
  };

  const remoteAgents = remotePresence.flatMap((peer) => peer.agents.map((agent) => ({
    key: `${peer.id}\u0000${agent.id}`, peer, agent
  })));

  useEffect(() => {
    if (!remoteAgentKey) return;
    const [memberId, agentId] = remoteAgentKey.split('\u0000');
    const stillTrusted = teamMembers.some((member) => member.memberId === memberId);
    const stillOnline = remotePresence.some((peer) => peer.id === memberId
      && peer.agents.some((agent) => agent.id === agentId));
    if (!stillTrusted || !stillOnline) {
      setRemoteAgentKey('');
      setRemotePrompt('');
      setRemoteTerminalInput('');
    }
  }, [remoteAgentKey, remotePresence, teamMembers]);

  const revokeTeamMember = async (member: TeamMemberSummary) => {
    setTeamBusy(true); setTeamNote('');
    try {
      const result = await window.cth.revokeOrgMember(member.memberId);
      if (!result.ok) throw new Error(result.error ?? t('teamMembers.revokeFailed'));
      if (remoteAgentKey.startsWith(`${member.memberId}\u0000`)) {
        setRemoteAgentKey('');
        setRemotePrompt('');
        setRemoteTerminalInput('');
      }
      await refreshTeamMembers();
    } catch (error) {
      setTeamNote(error instanceof Error ? error.message : String(error));
    } finally { setTeamBusy(false); }
  };

  return (
    <>
      <Field label={t('teamMembers.displayNameLabel')}>
        <input
          value={cfg.displayName}
          placeholder={t('teamMembers.displayNamePlaceholder')}
          onChange={(event) => apply({ ...cfg, displayName: event.target.value }, false)}
          onBlur={() => persistOrgTrigger(useStore.getState().orgTrigger)}
          maxLength={80}
        />
      </Field>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--cth-ink-700)' }}>
          {t('orgSection.acceptMessages')}
        </span>
        <Toggle on={cfg.enabled} onClick={() => apply({ ...cfg, enabled: !cfg.enabled })} />
      </div>

      <Field label={t('settings.connections.transportMode')}>
        <select
          value={cfg.connectionMode}
          onChange={(event) => apply({ ...cfg, connectionMode: event.target.value as OrgConnectionMode })}
          aria-label={t('settings.connections.transportMode')}
          style={{ width: '100%' }}
        >
          {ORG_CONNECTION_MODES.map((mode) => (
            <option key={mode} value={mode}>{t(`settings.connections.connectionMode.${mode}`)}</option>
          ))}
        </select>
      </Field>

      {cfg.connectionMode === 'managed-relay' && (
        <Field label={t('settings.connections.managedRelayEndpoint')}>
          <input
            type="text"
            value={cfg.managedRelayEndpoint}
            onChange={(event) => apply({ ...cfg, managedRelayEndpoint: event.target.value }, false)}
            onBlur={() => persistOrgTrigger(useStore.getState().orgTrigger)}
            placeholder={t('settings.connections.managedRelayEndpointPlaceholder')}
            aria-label={t('settings.connections.managedRelayEndpoint')}
          />
          <Hint>{t('orgSection.managedRelayEndpointHint')}</Hint>
        </Field>
      )}

      {cfg.connectionMode === 'self-hosted' && (
        <Field label={t('settings.connections.selfHostedEndpoint')}>
          <input
            type="text"
            value={cfg.selfHostedEndpoint}
            onChange={(event) => apply({ ...cfg, selfHostedEndpoint: event.target.value }, false)}
            onBlur={() => persistOrgTrigger(useStore.getState().orgTrigger)}
            placeholder={t('settings.connections.selfHostedUrlPlaceholder')}
            aria-label={t('settings.connections.selfHostedEndpoint')}
          />
          <Hint>{t('orgSection.selfHostedEndpointHint')}</Hint>
        </Field>
      )}

      {cfg.connectionMode === 'peer-to-peer' && (
        <Field label={t('settings.connections.peerToPeerEndpoint')}>
          <input
            type="text"
            value={cfg.peerToPeerEndpoint}
            onChange={(event) => apply({ ...cfg, peerToPeerEndpoint: event.target.value }, false)}
            onBlur={() => persistOrgTrigger(useStore.getState().orgTrigger)}
            placeholder={t('settings.connections.peerToPeerEndpointPlaceholder')}
            aria-label={t('settings.connections.peerToPeerEndpoint')}
          />
          <Hint>{t('orgSection.peerToPeerEndpointHint')}</Hint>
        </Field>
      )}

      <Field label={t('orgSection.trust')}>
        <ModePicker value={cfg.mode} onChange={(mode: TriggerMode) => apply({ ...cfg, mode })} />
      </Field>

      <Callout tone="note">
        {connectionStatus}
      </Callout>

      <Field label={t('teamMembers.title')}>
        <Hint>{t('teamMembers.description')}</Hint>
        {cfg.connectionMode === 'peer-to-peer' && <Hint>{t('teamMembers.peerToPeerInviteHint')}</Hint>}
        <Hint>{t('teamMembers.accessDirectionHint')}</Hint>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <PixelButton variant="secondary" size="sm" disabled={teamBusy} onClick={() => { void exportTeamInvite(); }}>
            {t('teamMembers.createInvite')}
          </PixelButton>
        </div>
        <textarea
          value={teamInviteText}
          onChange={(event) => { setTeamInviteText(event.target.value); setTeamInvite(null); }}
          aria-label={t('teamMembers.pasteInvite')}
          placeholder={t('teamMembers.pasteInvite')}
          rows={4}
          spellCheck={false}
          style={{ width: '100%', marginTop: 8, resize: 'vertical', fontFamily: 'monospace', fontSize: 11 }}
        />
        {teamInviteText && (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <PixelButton variant="ghost" size="sm" disabled={teamBusy} onClick={() => { void copyTeamInvite(); }}>
                {t('teamMembers.copyInvite')}
              </PixelButton>
            </div>
            <Hint>{t('teamMembers.shareHint')}</Hint>
          </>
        )}
        <PixelButton variant="secondary" size="sm" disabled={teamBusy || !teamInviteText.trim()} onClick={() => { void previewTeamInvite(); }}>
          {t('teamMembers.previewInvite')}
        </PixelButton>
        {teamInvite && (
          <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--cth-border)', borderRadius: 6 }}>
            <div style={{ fontWeight: 700 }}>{t('teamMembers.fingerprintFor', { name: teamInvite.displayName })}</div>
            <code style={{ display: 'block', margin: '6px 0', wordBreak: 'break-word' }}>{teamInvite.fingerprint}</code>
            {teamInvite.directEndpoint && <><Hint>{t('teamMembers.routePreview')}</Hint><code style={{ display: 'block', margin: '6px 0', wordBreak: 'break-all', fontSize: 10 }}>{teamInvite.directEndpoint}</code></>}
            <Hint>{t('teamMembers.verifyFingerprint')}</Hint>
            <input
              value={fingerprintConfirmation}
              onChange={(event) => setFingerprintConfirmation(event.target.value)}
              aria-label={t('teamMembers.fingerprintConfirmation')}
              placeholder={t('teamMembers.fingerprintConfirmation')}
              style={{ width: '100%', margin: '8px 0' }}
            />
            <PixelButton variant="primary" size="sm" disabled={teamBusy || !fingerprintConfirmation.trim()} onClick={() => { void pinTeamInvite(); }}>
              {t('teamMembers.trustMember')}
            </PixelButton>
          </div>
        )}
        {teamMembers.length > 0 && (
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {teamMembers.map((member) => (
              <div key={member.memberId} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: 8, border: '1px solid var(--cth-border)', borderRadius: 6 }}>
                <div style={{ flex: '1 1 180px' }}>
                  <div style={{ fontWeight: 700 }}>{member.displayName}</div>
                  <code style={{ fontSize: 10 }}>{member.fingerprint}</code>
                </div>
                <select
                  value={member.controlLevel}
                  disabled={teamBusy}
                  aria-label={t('teamMembers.accessGrantedTo', { name: member.displayName })}
                  onChange={(event) => { void changeMemberAccess(member, event.target.value as TeamMemberSummary['controlLevel']); }}
                >
                  {PEER_CONTROL_LEVELS.map((level) => <option key={level.value} value={level.value}>{t(`settings.connections.controlLevels.${level.value}`)}</option>)}
                </select>
                {member.controlLevel === 'full-control' && localAgents.some((agent) => !!agent.ptyId && !agent.isGod) && (
                  <div style={{ flex: '1 1 100%', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {localAgents.filter((agent) => !!agent.ptyId && !agent.isGod).map((agent) => {
                      const checked = (terminalShares[member.memberId] ?? []).includes(agent.id);
                      return <label key={agent.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                        <input type="checkbox" disabled={teamBusy || (!transportStatus.running && !checked)}
                          checked={checked}
                          onChange={(event) => { void setTerminalShare(member.memberId, agent.id, event.target.checked); }} />
                        {t('teamMembers.shareTerminalOutput', { name: agent.name })}
                      </label>;
                    })}
                    <Hint>{t('teamMembers.terminalShareHint')}</Hint>
                  </div>
                )}
                <PixelButton variant="ghost" size="sm" disabled={teamBusy} onClick={() => { void revokeTeamMember(member); }}>
                  {t('teamMembers.revoke')}
                </PixelButton>
              </div>
            ))}
          </div>
        )}
        {teamMembers.length > 0 && (
          <div style={{ display: 'grid', gap: 8, marginTop: 14, padding: 10, border: '1px solid var(--cth-border)', borderRadius: 6 }}>
            <div style={{ fontWeight: 700 }}>{t('teamMembers.collaborate')}</div>
            <Hint>{t('teamMembers.requestHint')}</Hint>
            <select value={requestMemberId} onChange={(event) => setRequestMemberId(event.target.value)} aria-label={t('teamMembers.requestRecipient')}>
              <option value="">{t('teamMembers.chooseTeammate')}</option>
              {teamMembers.map((member) => <option key={member.memberId} value={member.memberId}>{member.displayName}</option>)}
            </select>
            <input value={requestTitle} onChange={(event) => setRequestTitle(event.target.value)} maxLength={120}
              placeholder={t('teamMembers.requestTitle')} aria-label={t('teamMembers.requestTitle')} />
            <textarea value={requestMessage} onChange={(event) => setRequestMessage(event.target.value)} maxLength={8000}
              rows={3} placeholder={t('teamMembers.requestMessage')} aria-label={t('teamMembers.requestMessage')} />
            <PixelButton variant="ghost" size="sm" onClick={() => {
              // Once approved, the owner's orchestrator starts it (spawn-requests) on the owner's machine and plans.
              setRequestTitle('New agent request');
              setRequestMessage(`Please start an agent for ${cfg.displayName.trim() || 'me'}.\nName: \nRole: \nModel: Claude or Codex\nSeat: floor 2 CISO room / floor 3 design desk\nFirst task: `);
            }}>{t('teamMembers.requestAgent')}</PixelButton>
            <PixelButton variant="secondary" size="sm" disabled={teamBusy || !requestMemberId || !requestTitle.trim() || !requestMessage.trim() || !transportStatus.running}
              onClick={() => { void sendTaskRequest(); }}>{t('teamMembers.sendRequest')}</PixelButton>
            <Hint>{t('teamMembers.agentControlHint')}</Hint>
            <select value={remoteAgentKey} onChange={(event) => setRemoteAgentKey(event.target.value)} aria-label={t('teamMembers.remoteAgent')}>
              <option value="">{t('teamMembers.chooseRemoteAgent')}</option>
              {remoteAgents.map(({ key, peer, agent }) => <option key={key} value={key}>{peer.name} · {agent.name}</option>)}
            </select>
            <textarea value={remotePrompt} onChange={(event) => setRemotePrompt(event.target.value)} maxLength={8000} rows={2}
              placeholder={t('teamMembers.agentPrompt')} aria-label={t('teamMembers.agentPrompt')} />
            <PixelButton variant="secondary" size="sm" disabled={teamBusy || !remoteAgentKey || !remotePrompt.trim() || !transportStatus.running}
              onClick={() => { void sendRemotePrompt(); }}>{t('teamMembers.sendPrompt')}</PixelButton>
            <Hint>{t('teamMembers.fullControlHint')}</Hint>
            <input value={remoteTerminalInput} onChange={(event) => setRemoteTerminalInput(event.target.value)} maxLength={4096}
              placeholder={t('teamMembers.terminalInput')} aria-label={t('teamMembers.terminalInput')} />
            <PixelButton variant="ghost" size="sm" disabled={teamBusy || !remoteAgentKey || !remoteTerminalInput || !transportStatus.running}
              onClick={() => { void sendRemoteTerminalInput(); }}>{t('teamMembers.sendTerminalInput')}</PixelButton>
            {(() => {
              const [memberId, agentId] = remoteAgentKey.split('\u0000');
              return memberId && agentId
                ? <SharedTerminalOutput memberId={memberId} agentId={agentId} />
                : null;
            })()}
          </div>
        )}
        {teamNote && <Hint>{teamNote}</Hint>}
      </Field>

    </>
  );
}
