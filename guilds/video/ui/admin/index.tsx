import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { Button, Card, LoadingSpinner, ConfirmModal } from '@openconnect/ui';
import { videoApi, type VideoCall, type VideoStats } from '../shared/api';

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
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
    terminated_by_admin: 'bg-red-100 text-red-800',
    missed: 'bg-orange-100 text-orange-800',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function VideoDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<VideoStats>({ activeCalls: 0, todayTotal: 0, pendingRequests: 0 });
  const [pendingRequests, setPendingRequests] = useState<VideoCall[]>([]);
  const [activeCalls, setActiveCalls] = useState<VideoCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [terminateTarget, setTerminateTarget] = useState<VideoCall | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [s, pending, active] = await Promise.all([
        videoApi.getStats(),
        videoApi.getPendingRequests(),
        videoApi.getActiveCalls(),
      ]);
      setStats(s);
      setPendingRequests(pending);
      setActiveCalls(active);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Refresh every 15s
  useEffect(() => {
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, [loadData]);

  async function handleApprove(callId: string) {
    setActionLoading(callId);
    try {
      await videoApi.approveRequest(callId);
      await loadData();
    } catch (err) {
      console.error('Failed to approve:', err);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDeny(callId: string) {
    setActionLoading(callId);
    try {
      await videoApi.denyRequest(callId);
      await loadData();
    } catch (err) {
      console.error('Failed to deny:', err);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleTerminate() {
    if (!terminateTarget) return;
    setActionLoading(terminateTarget.id);
    try {
      await videoApi.terminateCall(terminateTarget.id);
      setTerminateTarget(null);
      await loadData();
    } catch (err) {
      console.error('Failed to terminate:', err);
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Video Call Management</h1>
        <button onClick={() => navigate('logs')} className="text-sm text-blue-600 hover:text-blue-800">
          View call logs
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card padding="md">
          <div className="text-center">
            <p className="text-3xl font-bold text-blue-600">{stats.activeCalls}</p>
            <p className="text-sm text-gray-600">Active Calls</p>
          </div>
        </Card>
        <Card padding="md">
          <div className="text-center">
            <p className="text-3xl font-bold text-yellow-600">{stats.pendingRequests}</p>
            <p className="text-sm text-gray-600">Pending Requests</p>
          </div>
        </Card>
        <Card padding="md">
          <div className="text-center">
            <p className="text-3xl font-bold text-green-600">{stats.todayTotal}</p>
            <p className="text-sm text-gray-600">Scheduled Today</p>
          </div>
        </Card>
      </div>

      {/* Pending Requests */}
      <Card padding="lg">
        <h2 className="text-lg font-semibold mb-4">Pending Approval Requests</h2>
        {pendingRequests.length === 0 ? (
          <p className="text-center py-4 text-gray-500">No pending requests.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {pendingRequests.map((call) => (
              <div key={call.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    {call.incarceratedPerson.firstName} {call.incarceratedPerson.lastName}
                    <span className="text-gray-400 mx-1">&larr;&rarr;</span>
                    {call.familyMember.firstName} {call.familyMember.lastName}
                  </p>
                  <p className="text-sm text-gray-500">
                    Requested for {formatDate(call.scheduledStart)}
                    {call.isLegal && <span className="ml-2 text-purple-600 font-medium">Legal</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    loading={actionLoading === call.id}
                    onClick={() => handleApprove(call.id)}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={actionLoading === call.id}
                    onClick={() => handleDeny(call.id)}
                  >
                    Deny
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Active Calls */}
      <Card padding="lg">
        <h2 className="text-lg font-semibold mb-4">Active Video Calls</h2>
        {activeCalls.length === 0 ? (
          <p className="text-center py-4 text-gray-500">No active calls.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {activeCalls.map((call) => (
              <div key={call.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    {call.incarceratedPerson.firstName} {call.incarceratedPerson.lastName}
                    <span className="text-gray-400 mx-1">&larr;&rarr;</span>
                    {call.familyMember.firstName} {call.familyMember.lastName}
                  </p>
                  <p className="text-sm text-gray-500">
                    Started {call.actualStart ? formatDate(call.actualStart) : 'N/A'}
                    {' '}— Ends {formatDate(call.scheduledEnd)}
                    {call.isLegal && <span className="ml-2 text-purple-600 font-medium">Legal — No Monitoring</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={call.status} />
                  {!call.isLegal && (
                    <Button size="sm" variant="danger" onClick={() => setTerminateTarget(call)}>
                      Terminate
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ConfirmModal
        isOpen={!!terminateTarget}
        onClose={() => setTerminateTarget(null)}
        onConfirm={handleTerminate}
        title="Terminate Call"
        message={terminateTarget ? `End the call between ${terminateTarget.incarceratedPerson.firstName} ${terminateTarget.incarceratedPerson.lastName} and ${terminateTarget.familyMember.firstName} ${terminateTarget.familyMember.lastName}?` : ''}
        confirmText="Terminate"
        variant="danger"
        loading={!!actionLoading}
      />
    </div>
  );
}

function CallLogs() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<VideoCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  async function loadLogs(p: number) {
    setLoading(true);
    try {
      const data = await videoApi.getCallLogs(p);
      setLogs(data.data);
      setTotalPages(data.pagination.totalPages);
      setPage(data.pagination.page);
    } catch (err) {
      console.error('Failed to load logs:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadLogs(1); }, []);

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/admin/video')} className="text-gray-500 hover:text-gray-700">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Call Logs</h1>
      </div>

      {logs.length === 0 ? (
        <Card padding="md"><p className="text-center text-gray-500 py-4">No call records.</p></Card>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Incarcerated Person</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Family Member</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scheduled</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {logs.map((call) => (
                  <tr key={call.id}>
                    <td className="px-4 py-3 text-sm">{call.incarceratedPerson.firstName} {call.incarceratedPerson.lastName}</td>
                    <td className="px-4 py-3 text-sm">{call.familyMember.firstName} {call.familyMember.lastName}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{formatDate(call.scheduledStart)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{call.durationSeconds ? `${Math.floor(call.durationSeconds / 60)}m` : '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={call.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => loadLogs(page - 1)}>Previous</Button>
              <span className="text-sm text-gray-500 py-2">Page {page} of {totalPages}</span>
              <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => loadLogs(page + 1)}>Next</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function VideoAdmin() {
  return (
    <Routes>
      <Route index element={<VideoDashboard />} />
      <Route path="logs" element={<CallLogs />} />
    </Routes>
  );
}
