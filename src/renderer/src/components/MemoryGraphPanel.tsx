import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildTeamMembers } from '@shared/agentTeams';
import { useStore } from '@/store/store';
import { getRemotePresence, subscribeRemotePresence } from '@/scene/office/remotePresence';
import { BlockGraphView, type MessagePreview } from './memoryGraph/BlockGraphView';
import type { MessageLogEntry } from './memoryGraph/buildGraph';
import { extractTopics } from './memoryGraph/extractTopics';

/** Graph-only projection of the existing roster, presence and message log.
 * Reads never submit prompts, wake agents or change their permission settings. */
export function MemoryGraphPanel({ godId, onJumpToMemory, onOpenChat, onToggleFullscreen, fullscreen = false }: {
  godId: string; onJumpToMemory: (agentId: string) => void; onOpenChat: (agentId: string) => void;
  onToggleFullscreen: () => void; fullscreen?: boolean;
}) {
  const agents = useStore(s => s.agents);
  const [presence,setPresence] = useState(getRemotePresence);
  const [log,setLog] = useState<MessageLogEntry[]>([]);
  const [now,setNow] = useState(Date.now);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState<string>();
  const [messageId,setMessageId] = useState<string>();
  const [preview,setPreview] = useState<MessagePreview>();
  const [previewLoading,setPreviewLoading] = useState(false);
  const [previewError,setPreviewError] = useState<string>();
  const [topicsOn,setTopicsOn] = useState(false);
  const [memories,setMemories] = useState<Record<string,string>>({});
  const [topicsLoading,setTopicsLoading] = useState(false);
  useEffect(() => subscribeRemotePresence(() => setPresence(getRemotePresence())), []);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setLog(await window.cth.hiveLog(200) as MessageLogEntry[]); setError(undefined); }
    catch { setError('Communication history is unavailable. Agent status and reporting lines are still shown.'); }
    finally { setNow(Date.now()); setLoading(false); }
  }, []);
  useEffect(() => {
    let alive=true,reading=false;
    const read = async () => {
      if(reading)return;reading=true;
      try { const next=await window.cth.hiveLog(200);if(alive){setLog(next as MessageLogEntry[]);setError(undefined);} }
      catch { if(alive)setError('Communication history is unavailable. Agent status and reporting lines are still shown.'); }
      finally {reading=false;if(alive){setNow(Date.now());setLoading(false);}}
    };
    void read();
    const timer=setInterval(read,5000);
    const off=window.cth.onHiveMessage(()=>{void read();});
    return()=>{alive=false;clearInterval(timer);off();};
  }, []);
  useEffect(() => {
    let alive=true;
    setPreview(undefined);setPreviewError(undefined);
    if(!messageId){setPreviewLoading(false);return;}
    setPreviewLoading(true);
    // Use the redacted message read layer; raw log subjects never enter the UI.
    void window.cth.hiveMessages({id:messageId,limit:1}).then(messages=>{
      if(!alive)return;
      const message=messages.find(m=>m.id===messageId);
      if(message)setPreview({id:message.id,subject:message.subject,body:message.body});
      else setPreviewError('Message content is no longer available.');
    }).catch(()=>{if(alive)setPreviewError('Message preview is unavailable.');}).finally(()=>{if(alive)setPreviewLoading(false);});
    return()=>{alive=false;};
  },[messageId]);
  useEffect(()=>{
    if(!topicsOn)return;
    let alive=true;
    const missing=agents.filter(a=>!a.archived && !(a.id in memories));
    if(!missing.length)return;
    setTopicsLoading(true);
    void Promise.all(missing.map(async a=>{try{return[a.id,await window.cth.hiveMemory(a.id)] as const;}catch{return[a.id,''] as const;}})).then(pairs=>{if(alive){setMemories(m=>({...m,...Object.fromEntries(pairs)}));setTopicsLoading(false);}});
    return()=>{alive=false;};
  },[topicsOn,agents.map(a=>a.id).join(',')]);
  const members=useMemo(()=>buildTeamMembers(agents,presence),[agents,presence]);
  const topics=useMemo(()=>extractTopics(memories),[memories]);
  return <BlockGraphView members={members} log={log} now={now} initialKey={`local:${godId}`} loading={loading} error={error} onRefresh={()=>{void refresh();}}
    onOpenChat={onOpenChat} onOpenMemory={onJumpToMemory} onExpand={onToggleFullscreen} expanded={fullscreen}
    preview={preview} previewLoading={previewLoading} previewError={previewError} onMessage={setMessageId}
    topics={topics} topicsOn={topicsOn} topicsLoading={topicsLoading} onToggleTopics={()=>setTopicsOn(v=>!v)} />;
}
