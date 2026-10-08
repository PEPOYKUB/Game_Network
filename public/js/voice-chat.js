import { socket } from './net.js';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

/** Room-scoped WebRTC mesh. Socket.IO carries signaling only; audio stays peer-to-peer. */
export function initVoiceChat({ getRoom, toast }) {
  const root = document.getElementById('voice-widget');
  const micButton = document.getElementById('voice-mic');
  const audioHost = document.getElementById('voice-audio-host');
  const state = {
    room: null, key: null, seat: null, channel: 'room', micEnabled: false,
    stream: null, roster: [], peers: new Map(), teamId: null,
    audioContext: null, analyser: null, meterTimer: null, localSpeaking: false,
    connected: socket.connected,
  };

  const ownPlayer = () => state.room?.players?.[state.seat] || null;
  const localAllows = (member) => state.room?.mode !== 'team' || state.channel !== 'team' || member.teamId === state.teamId;
  const remoteAllows = (member) => state.room?.mode !== 'team' || member.channel !== 'team' || member.teamId === state.teamId;
  const peerAllowed = (member) => member?.seat !== state.seat && member?.active && member?.connected
    && localAllows(member) && remoteAllows(member);

  function render() {
    const room = state.room;
    root.classList.toggle('hidden', !room || !state.connected);
    if (!room) return;
    const micLabel = state.micEnabled ? 'ปิดไมค์' : 'เปิดไมค์';
    const channelLabel = room.mode === 'team' ? ` · คลิกขวาสลับช่อง: ${state.channel === 'team' ? 'ทีม' : 'ทั้งห้อง'}` : '';
    micButton.title = `${micLabel}${channelLabel}`;
    micButton.setAttribute('aria-label', `${micLabel}${channelLabel}`);
    micButton.classList.toggle('active', state.micEnabled);
    micButton.setAttribute('aria-pressed', String(state.micEnabled));
  }

  function stopMeter() {
    clearInterval(state.meterTimer);
    state.meterTimer = null;
    state.analyser = null;
    if (state.audioContext) state.audioContext.close().catch(() => {});
    state.audioContext = null;
  }

  function setLocalSpeaking(speaking) {
    if (state.localSpeaking === speaking) return;
    state.localSpeaking = speaking;
    socket.emit('voice:activity', { speaking });
    render();
  }

  function startMeter() {
    stopMeter();
    if (!state.stream || !state.micEnabled) return;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      state.audioContext = new Context();
      const source = state.audioContext.createMediaStreamSource(state.stream);
      state.analyser = state.audioContext.createAnalyser();
      state.analyser.fftSize = 512;
      source.connect(state.analyser);
      const samples = new Uint8Array(state.analyser.fftSize);
      state.meterTimer = setInterval(() => {
        if (!state.analyser || !state.micEnabled) return;
        state.analyser.getByteTimeDomainData(samples);
        let power = 0;
        for (const sample of samples) { const value = (sample - 128) / 128; power += value * value; }
        const level = Math.sqrt(power / samples.length);
        setLocalSpeaking(state.localSpeaking ? level > 0.035 : level > 0.06);
      }, 140);
    } catch {
      // Speaking indication is optional if the browser does not support Web Audio.
    }
  }

  function sendSignal(to, signal) {
    if (socket.connected) socket.emit('voice:signal', { to, signal });
  }

  function closePeer(seat) {
    const peer = state.peers.get(seat);
    if (!peer) return;
    peer.pc.ontrack = null;
    peer.pc.onicecandidate = null;
    peer.pc.onnegotiationneeded = null;
    peer.pc.close();
    peer.audio?.remove();
    state.peers.delete(seat);
  }

  function closePeers() {
    for (const seat of [...state.peers.keys()]) closePeer(seat);
  }

  function createPeer(member) {
    if (state.peers.has(member.seat) || !state.room || !state.connected) return state.peers.get(member.seat);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const polite = String(state.seat).localeCompare(String(member.seat)) > 0;
    const peer = { pc, member, transceiver: null, audio: null, makingOffer: false, ignoreOffer: false, settingAnswer: false, polite };
    state.peers.set(member.seat, peer);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) sendSignal(member.seat, { candidate: candidate.toJSON() });
    };
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        sendSignal(member.seat, { description: pc.localDescription.toJSON() });
      } catch {
        // A simultaneous offer can race while a device is being enabled/disabled.
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.ontrack = ({ streams, track }) => {
      let audio = peer.audio;
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        audio.playsInline = true;
        audio.dataset.seat = member.seat;
        audioHost.append(audio);
        peer.audio = audio;
      }
      audio.srcObject = streams[0] || new MediaStream([track]);
      audio.play().catch(() => toast('อนุญาตให้เบราว์เซอร์เล่นเสียงเพื่อฟังเพื่อน', true));
    };
    peer.transceiver = pc.addTransceiver('audio', { direction: state.micEnabled ? 'sendrecv' : 'recvonly' });
    if (state.micEnabled) peer.transceiver.sender.replaceTrack(state.stream?.getAudioTracks()[0] || null).catch(() => {});
    return peer;
  }

  async function updatePeerTracks() {
    const track = state.micEnabled ? state.stream?.getAudioTracks()[0] || null : null;
    await Promise.all([...state.peers.values()].map(async (peer) => {
      if (!peer.transceiver) return;
      peer.transceiver.direction = state.micEnabled ? 'sendrecv' : 'recvonly';
      try { await peer.transceiver.sender.replaceTrack(track); } catch { /* Peer may be closing during a room change. */ }
    }));
  }

  function reconcilePeers() {
    const desired = new Map(state.roster.filter(peerAllowed).map((member) => [member.seat, member]));
    for (const seat of state.peers.keys()) if (!desired.has(seat)) closePeer(seat);
    for (const member of desired.values()) {
      const current = state.peers.get(member.seat);
      if (!current) createPeer(member);
      else current.member = member;
    }
  }

  async function receiveSignal({ from, signal }) {
    if (!state.room || !state.connected) return;
    const member = state.roster.find((entry) => entry.seat === from);
    if (!peerAllowed(member)) return;
    const peer = state.peers.get(from) || createPeer(member);
    if (!peer) return;
    const { pc } = peer;
    try {
      if (signal.description) {
        const readyForOffer = !peer.makingOffer && (pc.signalingState === 'stable' || peer.settingAnswer);
        const collision = signal.description.type === 'offer' && !readyForOffer;
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        peer.settingAnswer = signal.description.type === 'answer';
        await pc.setRemoteDescription(signal.description);
        peer.settingAnswer = false;
        if (signal.description.type === 'offer') {
          await pc.setLocalDescription();
          sendSignal(from, { description: pc.localDescription.toJSON() });
        }
      } else if (signal.candidate) {
        try { await pc.addIceCandidate(signal.candidate); }
        catch (error) { if (!peer.ignoreOffer) throw error; }
      }
    } catch {
      // The pair is renegotiated when either endpoint changes its microphone state.
    }
  }

  function sendSettings() {
    if (!state.room || !socket.connected) return;
    socket.emit('voice:settings', {
      active: true,
      channel: state.channel,
      micEnabled: state.micEnabled,
      speaking: state.localSpeaking,
    }, (result) => {
      if (!result?.ok) toast(result?.error || 'เชื่อมต่อแชทเสียงไม่ได้', true);
    });
  }

  async function setMicrophone(enabled) {
    if (enabled && !state.stream) {
      if (!navigator.mediaDevices?.getUserMedia) return toast('เบราว์เซอร์นี้ไม่รองรับไมโครโฟน', true);
      try {
        state.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
      } catch (error) {
        const message = error?.name === 'NotAllowedError' ? 'ยังไม่ได้อนุญาตใช้ไมโครโฟน' : 'ไม่พบไมโครโฟนหรือเปิดไมค์ไม่ได้';
        toast(message, true);
        return;
      }
    }
    state.micEnabled = Boolean(enabled);
    for (const track of state.stream?.getAudioTracks() || []) track.enabled = state.micEnabled;
    if (state.micEnabled) startMeter();
    else { stopMeter(); setLocalSpeaking(false); }
    await updatePeerTracks();
    sendSettings();
    render();
  }

  function stopSession(notify = true) {
    if (notify && state.room && socket.connected) socket.emit('voice:settings', { active: false, micEnabled: false, channel: 'room' });
    closePeers();
    stopMeter();
    for (const track of state.stream?.getTracks() || []) track.stop();
    state.stream = null;
    state.room = null;
    state.key = null;
    state.seat = null;
    state.teamId = null;
    state.micEnabled = false;
    state.localSpeaking = false;
    state.roster = [];
    root.classList.add('hidden');
    audioHost.replaceChildren();
  }

  function update(room) {
    if (!room?.code || !room.you) {
      stopSession();
      return;
    }
    const nextKey = `${room.code}:${room.you}`;
    if (state.key !== nextKey) {
      stopSession();
      state.key = nextKey;
      state.channel = 'room';
      state.room = room;
      state.seat = room.you;
      state.teamId = room.me?.teamId || room.players?.[room.you]?.teamId || null;
      sendSettings();
    } else {
      const nextTeam = room.me?.teamId || room.players?.[room.you]?.teamId || null;
      const changedTeam = state.teamId !== nextTeam;
      state.room = room;
      state.teamId = nextTeam;
      if (changedTeam) sendSettings();
      reconcilePeers();
    }
    render();
  }

  micButton.addEventListener('click', () => {
    setMicrophone(!state.micEnabled);
  });
  micButton.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (state.room?.mode !== 'team') return;
    state.channel = state.channel === 'team' ? 'room' : 'team';
    closePeers();
    sendSettings();
    render();
    toast(state.channel === 'team' ? 'แชทเสียง: คุยเฉพาะทีม' : 'แชทเสียง: คุยได้ทั้งห้อง');
  });

  socket.on('voice:roster', (members) => {
    state.roster = Array.isArray(members) ? members : [];
    reconcilePeers();
    render();
  });
  socket.on('voice:signal', receiveSignal);
  socket.on('voice:activity', ({ seat, speaking }) => {
    const member = state.roster.find((entry) => entry.seat === seat);
    if (member) member.speaking = Boolean(speaking);
    if (seat === state.seat) state.localSpeaking = Boolean(speaking);
    render();
  });
  socket.on('connect', () => {
    state.connected = true;
    sendSettings();
    render();
  });
  socket.on('disconnect', () => {
    state.connected = false;
    stopSession(false);
    state.connected = false;
    render();
  });
  socket.on('session:replaced', () => stopSession(false));

  return { update, stop: () => stopSession() };
}
