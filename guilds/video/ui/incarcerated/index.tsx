import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, LoadingSpinner } from '@openconnect/ui';
import { videoApi, type VideoCall } from '../shared/api';
import { VideoCallRoom } from '../shared/VideoCallRoom';

// TODO: Replace with useAuth() from shared package when auth context is extracted
function useCurrentUser() {
  const stored = localStorage.getItem('token');
  if (!stored) return null;
  try {
    const payload = JSON.parse(atob(stored.split('.')[1]));
    return { id: payload.sub, role: payload.role as 'family' | 'incarcerated' };
  } catch { return null; }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Now';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function canJoinCall(call: VideoCall): boolean {
  const now = new Date();
  const start = new Date(call.scheduledStart);
  const joinWindow = new Date(start.getTime() - 5 * 60 * 1000);
  const end = new Date(call.scheduledEnd);
  return (call.status === 'scheduled' || call.status === 'in_progress') && now >= joinWindow && now <= end;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    scheduled: 'bg-green-100 text-green-800',
    requested: 'bg-yellow-100 text-yellow-800',
    in_progress: 'bg-blue-100 text-blue-800',
    completed: 'bg-gray-100 text-gray-800',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function VideoHome() {
  const navigate = useNavigate();
  const [calls, setCalls] = useState<VideoCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadCalls = useCallback(async () => {
    try {
      setCalls(await videoApi.getMyCalls());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCalls(); }, [loadCalls]);

  // Poll every 30s
  useEffect(() => {
    const interval = setInterval(loadCalls, 30000);
    return () => clearInterval(interval);
  }, [loadCalls]);

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  const nextCall = calls.find((c) => c.status === 'scheduled' || c.status === 'in_progress');

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Video Calls</h1>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg">{error}</div>}

      {/* Next call highlight */}
      {nextCall && (
        <Card padding="lg">
          <div className="text-center">
            {canJoinCall(nextCall) ? (
              <>
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-green-800 mb-1">Call Ready</h2>
                <p className="text-gray-600 mb-4">
                  Video call with <span className="font-medium">{nextCall.familyMember.firstName} {nextCall.familyMember.lastName}</span>
                </p>
                {nextCall.isLegal && <p className="text-sm text-purple-600 font-medium mb-3">Legal Call — Not Monitored</p>}
                <Button size="lg" fullWidth onClick={() => navigate(`call/${nextCall.id}`)}>
                  Join Video Call
                </Button>
              </>
            ) : (
              <>
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold mb-1">Next Call</h2>
                <p className="text-gray-600">
                  With <span className="font-medium">{nextCall.familyMember.firstName} {nextCall.familyMember.lastName}</span>
                </p>
                <p className="text-2xl font-bold text-blue-600 my-2">{timeUntil(nextCall.scheduledStart)}</p>
                <p className="text-sm text-gray-500">{formatDate(nextCall.scheduledStart)}</p>
                {nextCall.isLegal && <p className="text-sm text-purple-600 font-medium mt-2">Legal Call</p>}
              </>
            )}
          </div>
        </Card>
      )}

      {/* All upcoming calls */}
      <h2 className="text-lg font-semibold text-gray-900">Upcoming Calls</h2>
      {calls.length === 0 ? (
        <Card padding="md">
          <p className="text-center text-gray-500 py-4">No upcoming video calls. Your family can schedule one from their app.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {calls.map((call) => (
            <Card key={call.id} padding="md">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{call.familyMember.firstName} {call.familyMember.lastName}</p>
                  <p className="text-sm text-gray-500">{formatDate(call.scheduledStart)}</p>
                  {call.isLegal && <span className="text-xs text-purple-600 font-medium">Legal Call</span>}
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={call.status} />
                  {canJoinCall(call) && (
                    <Button onClick={() => navigate(`call/${call.id}`)}>Join</Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="pt-2">
        <button onClick={() => navigate('history')} className="text-sm text-blue-600 hover:text-blue-800">
          View call history
        </button>
      </div>
    </div>
  );
}

function CallHistory() {
  const navigate = useNavigate();
  const [calls, setCalls] = useState<VideoCall[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    videoApi.getMyHistory().then(setCalls).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/incarcerated/video')} className="text-gray-500 hover:text-gray-700">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Call History</h1>
      </div>

      {calls.length === 0 ? (
        <Card padding="md"><p className="text-center text-gray-500 py-4">No past calls.</p></Card>
      ) : (
        <div className="space-y-2">
          {calls.map((call) => (
            <Card key={call.id} padding="md">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{call.familyMember.firstName} {call.familyMember.lastName}</p>
                  <p className="text-sm text-gray-500">{formatDate(call.scheduledStart)}</p>
                </div>
                <div className="text-right">
                  <StatusBadge status={call.status} />
                  {call.durationSeconds && (
                    <p className="text-xs text-gray-400 mt-1">{Math.floor(call.durationSeconds / 60)} min</p>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function VideoCallPage() {
  const navigate = useNavigate();
  const { callId } = useParams<{ callId: string }>();
  const user = useCurrentUser();

  if (!callId || !user) {
    return <div className="text-center py-12"><Button onClick={() => navigate('/incarcerated/video')}>Back</Button></div>;
  }

  return (
    <VideoCallRoom
      callId={callId}
      userId={user.id}
      userRole="incarcerated"
      onCallEnd={() => navigate('/incarcerated/video')}
    />
  );
}

export default function VideoIncarcerated() {
  return (
    <Routes>
      <Route index element={<VideoHome />} />
      <Route path="history" element={<CallHistory />} />
      <Route path="call/:callId" element={<VideoCallPage />} />
    </Routes>
  );
}
