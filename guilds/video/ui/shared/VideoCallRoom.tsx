import React, { useState, useEffect, useCallback } from 'react';
import { useWebRTC, type ConnectionState } from './useWebRTC';
import { videoApi } from './api';

interface VideoCallRoomProps {
  callId: string;
  userId: string;
  userRole: 'incarcerated' | 'family';
  onCallEnd: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function ConnectionOverlay({ state }: { state: ConnectionState }) {
  if (state === 'connected') return null;

  const messages: Record<ConnectionState, { title: string; sub: string }> = {
    connecting: { title: 'Connecting...', sub: 'Setting up your camera and microphone' },
    waiting: { title: 'Waiting for the other person...', sub: 'They will appear once they join' },
    disconnected: { title: 'Call Ended', sub: 'The call has been disconnected' },
  };

  const msg = messages[state];

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-900 bg-opacity-80">
      <div className="text-center text-white">
        {state !== 'disconnected' && (
          <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        )}
        <h2 className="text-xl font-semibold">{msg.title}</h2>
        <p className="text-gray-300 mt-1">{msg.sub}</p>
      </div>
    </div>
  );
}

export function VideoCallRoom({ callId, userId, userRole, onCallEnd }: VideoCallRoomProps) {
  const [scheduledEnd, setScheduledEnd] = useState<Date | null>(null);
  const [isLegal, setIsLegal] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [joinError, setJoinError] = useState('');
  const [joined, setJoined] = useState(false);
  const [roomId, setRoomId] = useState('');

  const handleCallEnded = useCallback((reason: string) => {
    // Report end to server
    videoApi.endCall(callId, reason === 'time_limit' ? 'time_limit' : 'user').catch(() => {});
    onCallEnd();
  }, [callId, onCallEnd]);

  const {
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
  } = useWebRTC({
    roomId,
    userId,
    userRole,
    enabled: joined && !!roomId,
    onCallEnded: handleCallEnded,
  });

  // Join the call via API
  useEffect(() => {
    if (joined) return;
    videoApi.joinCall(callId)
      .then((data) => {
        setRoomId(data.roomId);
        setScheduledEnd(new Date(data.scheduledEnd));
        setIsLegal(data.isLegal);
        setJoined(true);
      })
      .catch((err) => {
        setJoinError(err.message);
      });
  }, [callId, joined]);

  // Countdown timer
  useEffect(() => {
    if (!scheduledEnd) return;

    const tick = () => {
      const remaining = Math.max(0, Math.floor((scheduledEnd.getTime() - Date.now()) / 1000));
      setTimeRemaining(remaining);

      if (remaining <= 0) {
        endCall('time_limit');
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [scheduledEnd, endCall]);

  if (joinError) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center text-white">
          <h2 className="text-xl font-semibold mb-2">Unable to Join</h2>
          <p className="text-gray-300 mb-4">{joinError}</p>
          <button
            onClick={onCallEnd}
            className="px-6 py-2 bg-white text-gray-900 rounded-lg font-medium hover:bg-gray-100"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const timerWarning = timeRemaining !== null && timeRemaining <= 60;
  const timerCritical = timeRemaining !== null && timeRemaining <= 30;

  return (
    <div className="fixed inset-0 bg-gray-900 flex flex-col z-50">
      {/* Legal call banner */}
      {isLegal && (
        <div className="bg-purple-700 text-white text-center py-1 text-sm font-medium">
          Legal Call — Not Monitored or Recorded
        </div>
      )}

      {/* Video area */}
      <div className="flex-1 relative">
        <ConnectionOverlay state={connectionState} />

        {/* Remote video (full screen) */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />

        {/* Peer muted indicators */}
        {!peerVideoEnabled && connectionState === 'connected' && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
            <div className="text-center text-white">
              <div className="w-20 h-20 bg-gray-600 rounded-full flex items-center justify-center mx-auto mb-2">
                <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <p className="text-sm">Camera off</p>
            </div>
          </div>
        )}

        {!peerAudioEnabled && connectionState === 'connected' && (
          <div className="absolute top-4 left-4 bg-red-600 text-white px-3 py-1 rounded-full text-xs font-medium">
            Muted
          </div>
        )}

        {/* Local video (picture-in-picture) */}
        <div className="absolute bottom-24 right-4 w-32 h-24 sm:w-48 sm:h-36 rounded-lg overflow-hidden border-2 border-white shadow-lg">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover mirror"
            style={{ transform: 'scaleX(-1)' }}
          />
          {!videoEnabled && (
            <div className="absolute inset-0 bg-gray-700 flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>
          )}
        </div>

        {/* Timer */}
        {timeRemaining !== null && (
          <div className={`absolute top-4 right-4 px-4 py-2 rounded-full font-mono text-lg font-bold ${
            timerCritical ? 'bg-red-600 text-white animate-pulse' :
            timerWarning ? 'bg-yellow-500 text-white' :
            'bg-black bg-opacity-50 text-white'
          }`}>
            {formatTime(timeRemaining)}
          </div>
        )}
      </div>

      {/* Controls bar */}
      <div className="bg-gray-800 py-4 px-6">
        <div className="flex items-center justify-center gap-4">
          {/* Mic toggle */}
          <button
            onClick={toggleAudio}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
              audioEnabled ? 'bg-gray-600 hover:bg-gray-500' : 'bg-red-600 hover:bg-red-500'
            }`}
          >
            {audioEnabled ? (
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            )}
          </button>

          {/* Video toggle */}
          <button
            onClick={toggleVideo}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
              videoEnabled ? 'bg-gray-600 hover:bg-gray-500' : 'bg-red-600 hover:bg-red-500'
            }`}
          >
            {videoEnabled ? (
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            )}
          </button>

          {/* End call */}
          <button
            onClick={() => endCall('user')}
            className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition-colors"
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
