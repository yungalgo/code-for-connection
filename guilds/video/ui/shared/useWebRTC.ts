import { useRef, useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:3001';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export type ConnectionState = 'connecting' | 'waiting' | 'connected' | 'disconnected';

interface UseWebRTCOptions {
  roomId: string;
  userId: string;
  userRole: 'incarcerated' | 'family';
  enabled: boolean;
  onCallEnded?: (reason: string) => void;
}

export function useWebRTC({ roomId, userId, userRole, enabled, onCallEnded }: UseWebRTCOptions) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [peerAudioEnabled, setPeerAudioEnabled] = useState(true);
  const [peerVideoEnabled, setPeerVideoEnabled] = useState(true);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteSocketIdRef = useRef<string | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  const cleanup = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    socketRef.current?.disconnect();
    localStreamRef.current = null;
    pcRef.current = null;
    socketRef.current = null;
    remoteSocketIdRef.current = null;
    pendingCandidatesRef.current = [];
  }, []);

  const toggleAudio = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const track = stream.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setAudioEnabled(track.enabled);
      socketRef.current?.emit('mute-toggle', { roomId, type: 'audio', muted: !track.enabled });
    }
  }, [roomId]);

  const toggleVideo = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setVideoEnabled(track.enabled);
      socketRef.current?.emit('mute-toggle', { roomId, type: 'video', muted: !track.enabled });
    }
  }, [roomId]);

  const endCall = useCallback((reason: 'user' | 'time_limit') => {
    socketRef.current?.emit('call-ended', { roomId, reason });
    cleanup();
    setConnectionState('disconnected');
    onCallEnded?.(reason);
  }, [roomId, cleanup, onCallEnded]);

  useEffect(() => {
    if (!enabled || !roomId) return;

    let cancelled = false;

    function applyRemoteTracks(pc: RTCPeerConnection) {
      const remoteStream = new MediaStream();
      for (const receiver of pc.getReceivers()) {
        if (receiver.track) {
          remoteStream.addTrack(receiver.track);
        }
      }
      if (remoteVideoRef.current && remoteStream.getTracks().length > 0) {
        remoteVideoRef.current.srcObject = remoteStream;
        setConnectionState('connected');
      }
    }

    async function start() {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        } catch {
          setConnectionState('disconnected');
          return;
        }
      }

      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const socket = io(SIGNALING_URL, { transports: ['websocket', 'polling'] });
      socketRef.current = socket;

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.ontrack = () => applyRemoteTracks(pc);

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        const targetId = remoteSocketIdRef.current;
        if (targetId) {
          socket.emit('ice-candidate', { roomId, targetSocketId: targetId, candidate: event.candidate });
        } else {
          pendingCandidatesRef.current.push(event.candidate.toJSON());
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          applyRemoteTracks(pc);
        }
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          setConnectionState('disconnected');
        }
      };

      function setRemotePeer(socketId: string) {
        remoteSocketIdRef.current = socketId;
        for (const candidate of pendingCandidatesRef.current) {
          socket.emit('ice-candidate', { roomId, targetSocketId: socketId, candidate });
        }
        pendingCandidatesRef.current = [];
      }

      socket.on('connect', () => {
        socket.emit('join-room', { roomId, userId, userRole, callType: 'video' });
      });

      socket.on('room-joined', (data: { roomId: string; participants: Array<{ socketId: string }> }) => {
        if (data.participants.length === 0) {
          setConnectionState('waiting');
        } else {
          setRemotePeer(data.participants[0].socketId);
        }
      });

      socket.on('user-joined', async (data: { socketId: string }) => {
        setRemotePeer(data.socketId);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('offer', { roomId, targetSocketId: data.socketId, sdp: pc.localDescription });
        } catch (err) {
          console.error('Error creating offer:', err);
        }
      });

      socket.on('offer', async (data: { senderSocketId: string; sdp: RTCSessionDescriptionInit }) => {
        setRemotePeer(data.senderSocketId);
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('answer', { roomId, targetSocketId: data.senderSocketId, sdp: pc.localDescription });
          applyRemoteTracks(pc);
        } catch (err) {
          console.error('Error handling offer:', err);
        }
      });

      socket.on('answer', async (data: { sdp: RTCSessionDescriptionInit }) => {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          applyRemoteTracks(pc);
        } catch (err) {
          console.error('Error handling answer:', err);
        }
      });

      socket.on('ice-candidate', async (data: { candidate: RTCIceCandidateInit }) => {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
          console.error('Error adding ICE candidate:', err);
        }
      });

      socket.on('peer-mute-toggle', (data: { type: 'audio' | 'video'; muted: boolean }) => {
        if (data.type === 'audio') setPeerAudioEnabled(!data.muted);
        if (data.type === 'video') setPeerVideoEnabled(!data.muted);
      });

      socket.on('call-ended', (data: { reason: string }) => {
        cleanup();
        setConnectionState('disconnected');
        onCallEnded?.(data.reason);
      });

      socket.on('user-left', () => {
        setConnectionState('disconnected');
        onCallEnded?.('peer_left');
      });
    }

    start();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [roomId, userId, userRole, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-apply local stream if video element lost its srcObject (e.g. React re-mount)
  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current && !localVideoRef.current.srcObject) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  });

  return {
    localVideoRef,
    remoteVideoRef,
    connectionState,
    audioEnabled,
    videoEnabled,
    peerAudioEnabled,
    peerVideoEnabled,
    toggleAudio,
    toggleVideo,
    endCall,
  };
}
