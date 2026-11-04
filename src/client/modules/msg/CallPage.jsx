import { useEffect, useRef, useState } from 'react';
import { EmptyState, ErrorState } from '../../platform/feedback/states.jsx';
import { callApi } from '../../platform/messages/api.js';
import { follow } from '../../platform/realtime/socket.js';
import { navigateTo, usePageTitle } from '../core/pages/ui.jsx';

// Call (part 05.02, FR-08): a voice or video call between the people of a conversation, set up directly between browsers (WebRTC) with the company's STUN and TURN servers; the server only passes the messages
// that set a call up and never sees the sound or the picture. Mute, camera and (on a computer) screen sharing. Calls are never recorded. With an external provider the meeting opens at the provider's address.
const callId = () => Number(new URLSearchParams(window.location.search).get('call')) || null;
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function Remote({ stream, name, state }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current && stream) ref.current.srcObject = stream; }, [stream]);
  return (
    <figure className="call-tile" data-testid="call-remote" data-state={state}>
      <video ref={ref} autoPlay playsInline aria-label={`${name}'s picture`} />
      <figcaption>{name} · {state}</figcaption>
    </figure>
  );
}

export default function CallPage({ session }) {
  usePageTitle('Call');
  const id = callId();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [remotes, setRemotes] = useState({});
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [secs, setSecs] = useState(0);
  const [over, setOver] = useState(false);
  const local = useRef(null);
  const localVideo = useRef(null);
  const pcs = useRef(new Map());
  const pending = useRef(new Map());
  const me = session?.user;
  const hangup = useRef(() => {});

  useEffect(() => {
    if (!id) return undefined;
    let dead = false;
    const stopAll = () => { for (const { pc } of pcs.current.values()) pc.close(); pcs.current.clear(); local.current?.getTracks().forEach((t) => t.stop()); };
    const setState = (user, patch) => setRemotes((cur) => ({ ...cur, [user]: { ...(cur[user] ?? { name: user, state: 'connecting' }), ...patch } }));
    (async () => {
      let joined;
      try { joined = await callApi.join(id); } catch (e) { if (!dead) setError(e); return; }
      if (dead) return;
      setInfo(joined);
      if (joined.joinUrl) return; // an external provider: the meeting is opened from the button
      try { local.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: joined.call.type === 'VIDEO' }); } catch {
        try { local.current = await navigator.mediaDevices.getUserMedia({ audio: true }); setCamOff(true); } catch { setError(new Error('The microphone could not be used. Allow it in the browser and try again.')); return; }
      }
      if (localVideo.current) localVideo.current.srcObject = local.current;
      const name = (u) => [...joined.call.participants, ...joined.call.invited].find((p) => p.username === u)?.name ?? u;
      const open = (peer) => {
        if (pcs.current.has(peer)) return pcs.current.get(peer).pc;
        const pc = new RTCPeerConnection({ iceServers: joined.iceServers });
        pcs.current.set(peer, { pc });
        for (const t of local.current.getTracks()) pc.addTrack(t, local.current);
        pc.onicecandidate = (e) => { if (e.candidate) callApi.signal(id, { to: peer, kind: 'candidate', data: e.candidate.toJSON() }); };
        pc.ontrack = (e) => setRemotes((cur) => ({ ...cur, [peer]: { ...(cur[peer] ?? {}), name: name(peer), stream: e.streams[0], state: cur[peer]?.state ?? 'connecting' } }));
        pc.onconnectionstatechange = () => setState(peer, { name: name(peer), state: pc.connectionState === 'connected' ? 'connected' : pc.connectionState === 'failed' ? 'connection failed' : 'connecting' });
        setState(peer, { name: name(peer), state: 'connecting' });
        return pc;
      };
      const flush = async (peer) => { const pc = pcs.current.get(peer)?.pc; for (const c of pending.current.get(peer) ?? []) await pc.addIceCandidate(c).catch(() => {}); pending.current.set(peer, []); };
      const off = follow(`user:${me}`, async (ev) => {
        if (ev.type === 'msg.call.signal' && ev.data.callId === id) {
          const { from, kind, data } = ev.data;
          try {
            if (kind === 'offer') {
              const pc = open(from);
              await pc.setRemoteDescription(data);
              await flush(from);
              const ans = await pc.createAnswer();
              await pc.setLocalDescription(ans);
              callApi.signal(id, { to: from, kind: 'answer', data: { type: ans.type, sdp: ans.sdp } });
            } else if (kind === 'answer') { await pcs.current.get(from)?.pc.setRemoteDescription(data); await flush(from); }
            else if (kind === 'candidate') { const pc = pcs.current.get(from)?.pc; if (pc?.remoteDescription) await pc.addIceCandidate(data).catch(() => {}); else pending.current.set(from, [...(pending.current.get(from) ?? []), data]); }
            else if (kind === 'bye') { pcs.current.get(from)?.pc.close(); pcs.current.delete(from); setRemotes((cur) => { const n = { ...cur }; delete n[from]; return n; }); }
          } catch { /* a message that arrives out of turn is dropped; the connection is retried by the other side */ }
        }
        if (ev.type === 'msg.call.state' && ev.data?.callId === id && ['ENDED', 'MISSED', 'DECLINED'].includes(ev.data.status)) { setOver(true); stopAll(); }
      });
      // I am the newcomer: I offer to everyone already in the call
      for (const peer of joined.peers) {
        const pc = open(peer);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        callApi.signal(id, { to: peer, kind: 'offer', data: { type: offer.type, sdp: offer.sdp } });
      }
      hangup.current = async () => { for (const peer of pcs.current.keys()) callApi.signal(id, { to: peer, kind: 'bye', data: {} }); off(); stopAll(); try { await callApi.end(id); } catch { /* it ended already */ } };
    })();
    return () => { dead = true; stopAll(); };
  }, [id, me]);
  useEffect(() => { const t = setInterval(() => setSecs((s) => s + 1), 1000); return () => clearInterval(t); }, []);

  const toggleMute = () => { local.current?.getAudioTracks().forEach((t) => { t.enabled = muted; }); setMuted(!muted); };
  const toggleCam = () => { local.current?.getVideoTracks().forEach((t) => { t.enabled = camOff; }); setCamOff(!camOff); };
  const share = async () => {
    try {
      if (sharing) { const cam = local.current.getVideoTracks()[0]; for (const { pc } of pcs.current.values()) pc.getSenders().find((s) => s.track?.kind === 'video')?.replaceTrack(cam ?? null); setSharing(false); return; }
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = screen.getVideoTracks()[0];
      for (const { pc } of pcs.current.values()) { const sender = pc.getSenders().find((s) => s.track?.kind === 'video'); if (sender) await sender.replaceTrack(track); else pc.addTrack(track, screen); }
      track.onended = () => setSharing(false);
      setSharing(true);
    } catch { /* cancelled */ }
  };
  const leave = async () => { await hangup.current(); navigateTo(info ? `/collab/messages?c=${info.call.conversationId}` : '/collab/messages', { force: true }); };

  if (!id) return <EmptyState title="No call" message="Start a call from a conversation, or answer one that is ringing." action={{ label: 'Open Messages', onClick: () => navigateTo('/collab/messages') }} />;
  if (error) return <section data-testid="call-error"><h1>Call</h1><ErrorState error={error} onRetry={() => window.location.reload()} /></section>;
  const video = info?.call.type === 'VIDEO';
  return (
    <section aria-labelledby="call-title" className="call-screen" data-testid="call-screen" data-over={over}>
      <h1 id="call-title">{video ? 'Video call' : 'Voice call'}</h1>
      {!info && <p className="muted" role="status">Connecting...</p>}
      {over && <p role="status" className="notice" data-testid="call-over">The call is over. <button type="button" className="btn" onClick={() => navigateTo(`/collab/messages?c=${info.call.conversationId}`, { force: true })}>Back to the conversation</button></p>}
      {info?.joinUrl && <p><a className="btn btn-primary btn-large" href={info.joinUrl} target="_blank" rel="noopener noreferrer" data-testid="call-external">Open the meeting</a> <span className="muted small">at your company's call provider</span></p>}
      {info && !info.joinUrl && !over && (
        <>
          <p className="muted small" data-testid="call-timer">{fmt(secs)} · up to {info.maxParticipants} people · this call is not recorded</p>
          <div className="call-grid">
            {Object.entries(remotes).map(([u, r]) => <Remote key={u} stream={r.stream} name={r.name} state={r.state} />)}
            {Object.keys(remotes).length === 0 && <p className="muted" data-testid="call-waiting">Waiting for the others to join...</p>}
            <figure className="call-tile is-self"><video ref={localVideo} autoPlay playsInline muted aria-label="Your picture" /><figcaption>You{muted ? ' · muted' : ''}</figcaption></figure>
          </div>
          <div className="actions call-controls" role="group" aria-label="Call controls">
            <button type="button" className="btn btn-large" onClick={toggleMute} aria-pressed={muted} data-testid="call-mute">{muted ? 'Unmute' : 'Mute'}</button>
            {video && <button type="button" className="btn btn-large" onClick={toggleCam} aria-pressed={camOff} data-testid="call-camera">{camOff ? 'Camera on' : 'Camera off'}</button>}
            {navigator.mediaDevices?.getDisplayMedia && <button type="button" className="btn btn-large" onClick={share} aria-pressed={sharing} data-testid="call-share">{sharing ? 'Stop sharing' : 'Share screen'}</button>}
            <button type="button" className="btn btn-primary btn-large" onClick={leave} data-testid="call-hangup">Hang up</button>
          </div>
        </>
      )}
    </section>
  );
}
