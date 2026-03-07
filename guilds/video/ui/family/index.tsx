import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, LoadingSpinner, Modal } from '@openconnect/ui';
import { videoApi, type ApprovedContact, type VideoCall, type TimeSlot } from '../shared/api';
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

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    scheduled: 'bg-green-100 text-green-800',
    requested: 'bg-yellow-100 text-yellow-800',
    in_progress: 'bg-blue-100 text-blue-800',
    completed: 'bg-gray-100 text-gray-800',
    denied: 'bg-red-100 text-red-800',
    missed: 'bg-orange-100 text-orange-800',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function canJoinCall(call: VideoCall): boolean {
  const now = new Date();
  const start = new Date(call.scheduledStart);
  const joinWindow = new Date(start.getTime() - 5 * 60 * 1000);
  const end = new Date(call.scheduledEnd);
  return (call.status === 'scheduled' || call.status === 'in_progress') && now >= joinWindow && now <= end;
}

const IS_TEST_MODE = import.meta.env.VITE_TEST_MODE === 'true';

function VideoHome() {
  const navigate = useNavigate();
  const [calls, setCalls] = useState<VideoCall[]>([]);
  const [contacts, setContacts] = useState<ApprovedContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creatingTestCall, setCreatingTestCall] = useState(false);

  const loadCalls = useCallback(async () => {
    try {
      setLoading(true);
      const [callsData, contactsData] = await Promise.all([
        videoApi.getMyCalls(),
        IS_TEST_MODE ? videoApi.getApprovedContacts() : Promise.resolve([]),
      ]);
      setCalls(callsData);
      setContacts(contactsData);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCalls(); }, [loadCalls]);

  // Refresh every 30s to catch status changes
  useEffect(() => {
    const interval = setInterval(loadCalls, 30000);
    return () => clearInterval(interval);
  }, [loadCalls]);

  async function handleTestCall(incarceratedPersonId: string) {
    setCreatingTestCall(true);
    setError('');
    try {
      const call = await videoApi.createTestCall(incarceratedPersonId);
      navigate(`call/${call.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreatingTestCall(false);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Video Calls</h1>
        <Button onClick={() => navigate('request')}>Schedule a Call</Button>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg">{error}</div>}

      {/* Test mode: instant call button */}
      {IS_TEST_MODE && contacts.length > 0 && (
        <Card padding="md">
          <div className="border-2 border-dashed border-yellow-400 rounded-lg p-3 bg-yellow-50">
            <p className="text-sm font-semibold text-yellow-800 mb-2">TEST MODE — Start an instant call</p>
            <div className="space-y-2">
              {contacts.map((c) => (
                <Button
                  key={c.id}
                  fullWidth
                  loading={creatingTestCall}
                  onClick={() => handleTestCall(c.incarceratedPerson!.id)}
                >
                  Call {c.incarceratedPerson!.firstName} {c.incarceratedPerson!.lastName} NOW
                </Button>
              ))}
            </div>
          </div>
        </Card>
      )}

      {calls.length === 0 ? (
        <Card padding="lg">
          <div className="text-center py-8">
            <p className="text-gray-500 mb-4">No upcoming video calls.</p>
            <Button onClick={() => navigate('request')}>Schedule Your First Call</Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {calls.map((call) => (
            <Card key={call.id} padding="md">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-900">
                    {call.incarceratedPerson.firstName} {call.incarceratedPerson.lastName}
                  </p>
                  <p className="text-sm text-gray-500">{formatDate(call.scheduledStart)}</p>
                  {call.isLegal && <span className="text-xs text-purple-600 font-medium">Legal Call</span>}
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={call.status} />
                  {canJoinCall(call) && (
                    <Button onClick={() => navigate(`call/${call.id}`)}>
                      Join Call
                    </Button>
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

function RequestCall() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<ApprovedContact[]>([]);
  const [selectedContact, setSelectedContact] = useState<ApprovedContact | null>(null);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [slotDuration, setSlotDuration] = useState(30);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    videoApi.getApprovedContacts().then(setContacts).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  async function handleContactSelect(contact: ApprovedContact) {
    setSelectedContact(contact);
    setError('');
    try {
      const data = await videoApi.getTimeSlots(contact.incarceratedPerson!.id);
      setSlots(data.slots);
      setSlotDuration(data.slotDurationMinutes);
    } catch (err: any) {
      setError(err.message);
    }
  }

  function getAvailableTimes(): string[] {
    if (!selectedDate || slots.length === 0) return [];
    const date = new Date(selectedDate + 'T00:00:00');
    const dayOfWeek = date.getDay();
    const daySlots = slots.filter((s) => s.dayOfWeek === dayOfWeek);

    const times: string[] = [];
    for (const slot of daySlots) {
      const [startH, startM] = slot.startTime.split(':').map(Number);
      const [endH, endM] = slot.endTime.split(':').map(Number);
      let h = startH, m = startM;
      while (h < endH || (h === endH && m < endM)) {
        times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
        m += slotDuration;
        if (m >= 60) { h += Math.floor(m / 60); m = m % 60; }
      }
    }
    return times;
  }

  async function handleSubmit() {
    if (!selectedContact || !selectedDate || !selectedTime) return;
    setSubmitting(true);
    setError('');
    try {
      const scheduledStart = `${selectedDate}T${selectedTime}:00`;
      await videoApi.requestCall(selectedContact.incarceratedPerson!.id, scheduledStart);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // Get next 14 days for date picker
  const dateOptions: string[] = [];
  for (let i = 1; i <= 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dateOptions.push(d.toISOString().split('T')[0]);
  }

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  const availableTimes = getAvailableTimes();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/family/video')} className="text-gray-500 hover:text-gray-700">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Schedule a Video Call</h1>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg">{error}</div>}

      <Modal isOpen={success} onClose={() => navigate('/family/video')} title="Call Scheduled!">
        <p className="text-gray-600 mb-4">Your video call has been scheduled.</p>
        <Button fullWidth onClick={() => navigate('/family/video')}>Back to Video Calls</Button>
      </Modal>

      {/* Step 1: Select contact */}
      <Card padding="md">
        <h2 className="text-lg font-semibold mb-3">1. Choose who to call</h2>
        {contacts.length === 0 ? (
          <p className="text-gray-500">No approved contacts. Contact the facility to add someone.</p>
        ) : (
          <div className="space-y-2">
            {contacts.map((contact) => (
              <button
                key={contact.id}
                onClick={() => handleContactSelect(contact)}
                className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                  selectedContact?.id === contact.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <p className="font-medium">
                  {contact.incarceratedPerson!.firstName} {contact.incarceratedPerson!.lastName}
                </p>
                <p className="text-sm text-gray-500">
                  {contact.relationship} {contact.isAttorney && '(Attorney)'} — {contact.incarceratedPerson!.facility.name}
                </p>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Step 2: Pick date */}
      {selectedContact && (
        <Card padding="md">
          <h2 className="text-lg font-semibold mb-3">2. Pick a date</h2>
          <p className="text-sm text-gray-500 mb-3">
            Call duration: {slotDuration} minutes.
            {slots.length > 0 && ` Available ${DAY_NAMES[slots[0].dayOfWeek]}–${DAY_NAMES[slots[slots.length - 1].dayOfWeek]}.`}
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {dateOptions.map((date) => {
              const d = new Date(date + 'T00:00:00');
              const dayOfWeek = d.getDay();
              const hasSlots = slots.some((s) => s.dayOfWeek === dayOfWeek);
              return (
                <button
                  key={date}
                  disabled={!hasSlots}
                  onClick={() => { setSelectedDate(date); setSelectedTime(''); }}
                  className={`p-2 rounded-lg text-sm border-2 transition-colors ${
                    selectedDate === date
                      ? 'border-blue-500 bg-blue-50'
                      : hasSlots
                        ? 'border-gray-200 hover:border-gray-300'
                        : 'border-gray-100 text-gray-300 cursor-not-allowed'
                  }`}
                >
                  <div className="font-medium">{DAY_NAMES[dayOfWeek].slice(0, 3)}</div>
                  <div>{d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* Step 3: Pick time */}
      {selectedDate && (
        <Card padding="md">
          <h2 className="text-lg font-semibold mb-3">3. Pick a time</h2>
          {availableTimes.length === 0 ? (
            <p className="text-gray-500">No time slots available on this day.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {availableTimes.map((time) => (
                <button
                  key={time}
                  onClick={() => setSelectedTime(time)}
                  className={`p-2 rounded-lg text-sm border-2 transition-colors ${
                    selectedTime === time
                      ? 'border-blue-500 bg-blue-50 font-medium'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {time}
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Submit */}
      {selectedTime && (
        <Button fullWidth loading={submitting} onClick={handleSubmit}>
          Schedule Call — {new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at {selectedTime}
        </Button>
      )}
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
        <button onClick={() => navigate('/family/video')} className="text-gray-500 hover:text-gray-700">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Call History</h1>
      </div>

      {calls.length === 0 ? (
        <Card padding="lg"><p className="text-center text-gray-500 py-4">No past calls.</p></Card>
      ) : (
        <div className="space-y-2">
          {calls.map((call) => (
            <Card key={call.id} padding="md">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{call.incarceratedPerson.firstName} {call.incarceratedPerson.lastName}</p>
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
    return <div className="text-center py-12"><Button onClick={() => navigate('/family/video')}>Back</Button></div>;
  }

  return (
    <VideoCallRoom
      callId={callId}
      userId={user.id}
      userRole="family"
      onCallEnd={() => navigate('/family/video')}
    />
  );
}

export default function VideoFamily() {
  return (
    <Routes>
      <Route index element={<VideoHome />} />
      <Route path="request" element={<RequestCall />} />
      <Route path="history" element={<CallHistory />} />
      <Route path="call/:callId" element={<VideoCallPage />} />
    </Routes>
  );
}
