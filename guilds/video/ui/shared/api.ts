const API_BASE = '/api/video';

function getHeaders(): HeadersInit {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: getHeaders(),
    ...options,
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error?.message || 'Request failed');
  }
  return data.data;
}

export interface ApprovedContact {
  id: string;
  relationship: string;
  isAttorney: boolean;
  incarceratedPerson?: {
    id: string;
    firstName: string;
    lastName: string;
    externalId: string;
    facility: { id: string; name: string };
    housingUnit: { unitType: { videoSlotDurationMinutes: number } };
  };
  familyMember?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
}

export interface TimeSlot {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  maxConcurrent: number;
}

export interface TimeSlotsResponse {
  slots: TimeSlot[];
  slotDurationMinutes: number;
  maxConcurrent: number;
}

export interface VideoCall {
  id: string;
  status: string;
  isLegal: boolean;
  scheduledStart: string;
  scheduledEnd: string;
  actualStart?: string;
  actualEnd?: string;
  durationSeconds?: number;
  endedBy?: string;
  incarceratedPerson: {
    id: string;
    firstName: string;
    lastName: string;
    externalId?: string;
  };
  familyMember: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  facility?: {
    id: string;
    name: string;
  };
}

export interface JoinCallResponse {
  roomId: string;
  callId: string;
  scheduledEnd: string;
  isLegal: boolean;
}

export interface VideoStats {
  activeCalls: number;
  todayTotal: number;
  pendingRequests: number;
}

export const videoApi = {
  getApprovedContacts: () => request<ApprovedContact[]>('/approved-contacts'),

  getTimeSlots: (incarceratedPersonId: string) =>
    request<TimeSlotsResponse>(`/time-slots?incarceratedPersonId=${incarceratedPersonId}`),

  requestCall: (incarceratedPersonId: string, scheduledStart: string) =>
    request<VideoCall>('/request', {
      method: 'POST',
      body: JSON.stringify({ incarceratedPersonId, scheduledStart }),
    }),

  getMyCalls: () => request<VideoCall[]>('/my-calls'),

  getMyHistory: () => request<VideoCall[]>('/my-history'),

  joinCall: (callId: string) =>
    request<JoinCallResponse>(`/join/${callId}`, { method: 'POST' }),

  endCall: (callId: string, reason: 'user' | 'time_limit') =>
    request<VideoCall>(`/end/${callId}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  // Admin
  getStats: () => request<VideoStats>('/stats'),
  getActiveCalls: () => request<VideoCall[]>('/active-calls'),
  getPendingRequests: () => request<VideoCall[]>('/pending-requests'),
  getCallLogs: (page = 1) => fetch(`${API_BASE}/call-logs?page=${page}`, { headers: getHeaders() }).then(r => r.json()),
  approveRequest: (callId: string) =>
    request<VideoCall>(`/approve-request/${callId}`, { method: 'POST' }),
  denyRequest: (callId: string) =>
    request<VideoCall>(`/deny-request/${callId}`, { method: 'POST' }),
  terminateCall: (callId: string) =>
    request<VideoCall>(`/terminate-call/${callId}`, { method: 'POST' }),

  // Test mode only
  createTestCall: (incarceratedPersonId: string) =>
    request<VideoCall>('/test/create-call', {
      method: 'POST',
      body: JSON.stringify({ incarceratedPersonId }),
    }),
};
