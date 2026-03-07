import { Router, Request, Response } from 'express';
import {
  requireAuth,
  requireRole,
  createSuccessResponse,
  createErrorResponse,
  prisma,
} from '@openconnect/shared';

export const videoRouter = Router();

const TEST_MODE = process.env.TEST_MODE === 'true';
const ADMIN_APPROVAL_REQUIRED = process.env.ADMIN_APPROVAL_REQUIRED === 'true';

// ==========================================
// TEST ENDPOINT (only available in TEST_MODE)
// ==========================================

if (TEST_MODE) {
  // Creates a video call starting NOW, joinable immediately — for local dev testing
  videoRouter.post('/test/create-call', requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const role = req.user!.role;

      if (role !== 'family') {
        res.status(400).json(createErrorResponse({ code: 'BAD_REQUEST', message: 'Only family members can create test calls' }));
        return;
      }

      const { incarceratedPersonId } = req.body;

      const contact = await prisma.approvedContact.findUnique({
        where: {
          incarceratedPersonId_familyMemberId: {
            incarceratedPersonId,
            familyMemberId: userId,
          },
        },
      });

      if (!contact || contact.status !== 'approved') {
        res.status(403).json(createErrorResponse({ code: 'FORBIDDEN', message: 'Not an approved contact' }));
        return;
      }

      const person = await prisma.incarceratedPerson.findUnique({
        where: { id: incarceratedPersonId },
        include: { housingUnit: { include: { unitType: true } } },
      });

      if (!person) {
        res.status(404).json(createErrorResponse({ code: 'NOT_FOUND', message: 'Person not found' }));
        return;
      }

      const now = new Date();
      const durationMs = person.housingUnit.unitType.videoCallDurationMinutes * 60 * 1000;
      const end = new Date(now.getTime() + durationMs);

      const call = await prisma.videoCall.create({
        data: {
          incarceratedPersonId,
          familyMemberId: userId,
          facilityId: person.facilityId,
          status: 'scheduled',
          isLegal: false,
          scheduledStart: now,
          scheduledEnd: end,
          requestedBy: userId,
        },
        include: {
          incarceratedPerson: true,
          familyMember: true,
          facility: true,
        },
      });

      console.log(`[TEST_MODE] Created test call ${call.id} starting now`);
      res.status(201).json(createSuccessResponse(call));
    } catch (error) {
      console.error('Error creating test call:', error);
      res.status(500).json(createErrorResponse({ code: 'INTERNAL_ERROR', message: 'Failed to create test call' }));
    }
  });
}

// ==========================================
// FAMILY + INCARCERATED ENDPOINTS
// ==========================================

// Get approved contacts for the current user (family sees incarcerated persons, incarcerated sees family members)
videoRouter.get('/approved-contacts', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const role = req.user!.role;

    let contacts;
    if (role === 'family') {
      contacts = await prisma.approvedContact.findMany({
        where: { familyMemberId: userId, status: 'approved' },
        include: {
          incarceratedPerson: {
            include: { facility: true, housingUnit: { include: { unitType: true } } },
          },
        },
      });
    } else if (role === 'incarcerated') {
      contacts = await prisma.approvedContact.findMany({
        where: { incarceratedPersonId: userId, status: 'approved' },
        include: { familyMember: true },
      });
    } else {
      res.status(403).json(createErrorResponse({ code: 'FORBIDDEN', message: 'Admins use other endpoints' }));
      return;
    }

    res.json(createSuccessResponse(contacts));
  } catch (error) {
    console.error('Error fetching approved contacts:', error);
    res.status(500).json(createErrorResponse({ code: 'INTERNAL_ERROR', message: 'Failed to fetch contacts' }));
  }
});

// Get available time slots for a specific incarcerated person's facility/housing unit type
videoRouter.get('/time-slots', requireAuth, async (req: Request, res: Response) => {
  try {
    const { incarceratedPersonId } = req.query;

    if (!incarceratedPersonId) {
      res.status(400).json(createErrorResponse({ code: 'VALIDATION_ERROR', message: 'incarceratedPersonId is required' }));
      return;
    }

    const person = await prisma.incarceratedPerson.findUnique({
      where: { id: String(incarceratedPersonId) },
      include: { housingUnit: { include: { unitType: true } } },
    });

    if (!person) {
      res.status(404).json(createErrorResponse({ code: 'NOT_FOUND', message: 'Person not found' }));
      return;
    }

    const slots = await prisma.videoCallTimeSlot.findMany({
      where: {
        facilityId: person.facilityId,
        housingUnitTypeId: person.housingUnit.unitTypeId,
      },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });

    res.json(createSuccessResponse({
      slots,
      slotDurationMinutes: person.housingUnit.unitType.videoSlotDurationMinutes,
      maxConcurrent: person.housingUnit.unitType.maxConcurrentVideoCalls,
    }));
  } catch (error) {
    console.error('Error fetching time slots:', error);
    res.status(500).json(createErrorResponse({ code: 'INTERNAL_ERROR', message: 'Failed to fetch time slots' }));
  }
});

// Request a video call (family member initiates)
videoRouter.post('/request', requireAuth, async (req: Request, res: Response) => {
  try {
    const { incarceratedPersonId, scheduledStart } = req.body;
    const familyMemberId = req.user!.id;

    if (!incarceratedPersonId || !scheduledStart) {
      res.status(400).json(createErrorResponse({
        code: 'VALIDATION_ERROR',
        message: 'incarceratedPersonId and scheduledStart are required',
      }));
      return;
    }

    // Verify approved contact
    const contact = await prisma.approvedContact.findUnique({
      where: {
        incarceratedPersonId_familyMemberId: {
          incarceratedPersonId,
          familyMemberId,
        },
      },
    });

    if (!contact || contact.status !== 'approved') {
      res.status(403).json(createErrorResponse({ code: 'FORBIDDEN', message: 'Not an approved contact' }));
      return;
    }

    // Get the incarcerated person's facility and housing unit config
    const person = await prisma.incarceratedPerson.findUnique({
      where: { id: incarceratedPersonId },
      include: { housingUnit: { include: { unitType: true } } },
    });

    if (!person) {
      res.status(404).json(createErrorResponse({ code: 'NOT_FOUND', message: 'Person not found' }));
      return;
    }

    const start = new Date(scheduledStart);
    const durationMs = person.housingUnit.unitType.videoCallDurationMinutes * 60 * 1000;
    const end = new Date(start.getTime() + durationMs);

    // Check the time slot exists for this day/time (skipped in TEST_MODE)
    if (!TEST_MODE) {
      const dayOfWeek = start.getDay();
      const timeStr = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;

      const matchingSlot = await prisma.videoCallTimeSlot.findFirst({
        where: {
          facilityId: person.facilityId,
          housingUnitTypeId: person.housingUnit.unitTypeId,
          dayOfWeek,
          startTime: { lte: timeStr },
          endTime: { gte: timeStr },
        },
      });

      if (!matchingSlot) {
        res.status(400).json(createErrorResponse({ code: 'INVALID_SLOT', message: 'No available time slot for this date/time' }));
        return;
      }

      // Check concurrent call count for this slot
      const concurrentCalls = await prisma.videoCall.count({
        where: {
          facilityId: person.facilityId,
          status: { in: ['scheduled', 'approved', 'in_progress'] },
          scheduledStart: { lt: end },
          scheduledEnd: { gt: start },
        },
      });

      if (concurrentCalls >= matchingSlot.maxConcurrent) {
        res.status(409).json(createErrorResponse({ code: 'SLOT_FULL', message: 'This time slot is full' }));
        return;
      }
    }

    // Auto-approve if contact is approved AND admin approval is not required
    const isAutoApproved = contact.status === 'approved' && !ADMIN_APPROVAL_REQUIRED;

    const videoCall = await prisma.videoCall.create({
      data: {
        incarceratedPersonId,
        familyMemberId,
        facilityId: person.facilityId,
        status: isAutoApproved ? 'scheduled' : 'requested',
        isLegal: contact.isAttorney,
        scheduledStart: start,
        scheduledEnd: end,
        requestedBy: familyMemberId,
      },
      include: {
        incarceratedPerson: true,
        familyMember: true,
      },
    });

    res.status(201).json(createSuccessResponse(videoCall));
  } catch (error) {
    console.error('Error requesting video call:', error);
    res.status(500).json(createErrorResponse({ code: 'INTERNAL_ERROR', message: 'Failed to request video call' }));
  }
});

// Get my upcoming calls (works for family and incarcerated)
videoRouter.get('/my-calls', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const role = req.user!.role;

    const userFilter = role === 'family'
      ? { familyMemberId: userId }
      : role === 'incarcerated'
        ? { incarceratedPersonId: userId }
        : {};

    const calls = await prisma.videoCall.findMany({
      where: {
        ...userFilter,
        status: { in: ['scheduled', 'approved', 'requested', 'in_progress'] },
        scheduledEnd: { gte: new Date() },
      },
      include: {
        incarceratedPerson: true,
        familyMember: true,
        facility: true,
      },
      orderBy: { scheduledStart: 'asc' },
    });

    res.json(createSuccessResponse(calls));
  } catch (error) {
    console.error('Error fetching my calls:', error);
    res.status(500).json(createErrorResponse({ code: 'INTERNAL_ERROR', message: 'Failed to fetch calls' }));
  }
});

// Get call history (past calls for family and incarcerated)
videoRouter.get('/my-history', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const role = req.user!.role;

    const userFilter = role === 'family'
      ? { familyMemberId: userId }
      : role === 'incarcerated'
        ? { incarceratedPersonId: userId }
        : {};

    const calls = await prisma.videoCall.findMany({
      where: {
        ...userFilter,
        status: { in: ['completed', 'missed', 'terminated_by_admin'] },
      },
      include: {
        incarceratedPerson: true,
        familyMember: true,
      },
      orderBy: { scheduledStart: 'desc' },
      take: 20,
    });

    res.json(createSuccessResponse(calls));
  } catch (error) {
    console.error('Error fetching call history:', error);
    res.status(500).json(createErrorResponse({ code: 'INTERNAL_ERROR', message: 'Failed to fetch history' }));
  }
});

// Join a video call — transitions to in_progress, returns room info
videoRouter.post('/join/:callId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { callId } = req.params;
    const userId = req.user!.id;
    const role = req.user!.role;

    const call = await prisma.videoCall.findUnique({ where: { id: callId } });

    if (!call) {
      res.status(404).json(createErrorResponse({ code: 'NOT_FOUND', message: 'Call not found' }));
      return;
    }

    // Verify the user is a participant
    if (role === 'family' && call.familyMemberId !== userId) {
      res.status(403).json(createErrorResponse({ code: 'FORBIDDEN', message: 'Not your call' }));
      return;
    }
    if (role === 'incarcerated' && call.incarceratedPersonId !== userId) {
      res.status(403).json(createErrorResponse({ code: 'FORBIDDEN', message: 'Not your call' }));
      return;
    }

    // Must be scheduled or already in progress
    if (!['scheduled', 'in_progress'].includes(call.status)) {
      res.status(400).json(createErrorResponse({ code: 'INVALID_STATE', message: `Call is ${call.status}, cannot join` }));
      return;
    }

    // Check join window: 5 minutes before scheduled start
    const joinWindowStart = new Date(call.scheduledStart.getTime() - 5 * 60 * 1000);
    if (new Date() < joinWindowStart) {
      res.status(400).json(createErrorResponse({
        code: 'TOO_EARLY',
        message: `Call opens at ${joinWindowStart.toISOString()}`,
      }));
      return;
    }

    // If first person to join, transition to in_progress
    if (call.status === 'scheduled') {
      await prisma.videoCall.update({
        where: { id: callId },
        data: {
          status: 'in_progress',
          actualStart: new Date(),
        },
      });
    }

    // Room ID is the call ID — the signaling server uses this
    res.json(createSuccessResponse({
      roomId: callId,
      callId,
      scheduledEnd: call.scheduledEnd,
      isLegal: call.isLegal,
    }));
  } catch (error) {
    console.error('Error joining video call:', error);
    res.status(500).json(createErrorResponse({ code: 'INTERNAL_ERROR', message: 'Failed to join call' }));
  }
});

// End a video call
videoRouter.post('/end/:callId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { callId } = req.params;
    const userId = req.user!.id;
    const role = req.user!.role;
    const { reason } = req.body; // 'user' | 'time_limit'

    const call = await prisma.videoCall.findUnique({ where: { id: callId } });

    if (!call) {
      res.status(404).json(createErrorResponse({ code: 'NOT_FOUND', message: 'Call not found' }));
      return;
    }

    if (call.status !== 'in_progress') {
      res.status(400).json(createErrorResponse({ code: 'INVALID_STATE', message: 'Call is not in progress' }));
      return;
    }

    let endedBy: 'incarcerated' | 'family' | 'time_limit';
    if (reason === 'time_limit') {
      endedBy = 'time_limit';
    } else if (role === 'incarcerated') {
      endedBy = 'incarcerated';
    } else {
      endedBy = 'family';
    }

    const now = new Date();
    const durationSeconds = call.actualStart
      ? Math.floor((now.getTime() - call.actualStart.getTime()) / 1000)
      : 0;

    const updatedCall = await prisma.videoCall.update({
      where: { id: callId },
      data: {
        status: 'completed',
        actualEnd: now,
        durationSeconds,
        endedBy,
      },
    });

    res.json(createSuccessResponse(updatedCall));
  } catch (error) {
    console.error('Error ending video call:', error);
    res.status(500).json(createErrorResponse({ code: 'INTERNAL_ERROR', message: 'Failed to end call' }));
  }
});

// ==========================================
// ADMIN ENDPOINTS (pre-existing)
// ==========================================

videoRouter.get('/active-calls', requireAuth, requireRole('facility_admin', 'agency_admin'), async (req: Request, res: Response) => {
  try {
    const { facilityId } = req.query;

    const activeCalls = await prisma.videoCall.findMany({
      where: {
        status: 'in_progress',
        ...(facilityId ? { facilityId: String(facilityId) } : {}),
      },
      include: {
        incarceratedPerson: true,
        familyMember: true,
      },
      orderBy: { actualStart: 'desc' },
    });

    res.json(createSuccessResponse(activeCalls));
  } catch (error) {
    console.error('Error fetching active video calls:', error);
    res.status(500).json(createErrorResponse({ code: 'INTERNAL_ERROR', message: 'Failed to fetch active calls' }));
  }
});

videoRouter.get('/call-logs', requireAuth, async (req: Request, res: Response) => {
  try {
    const { facilityId, startDate, endDate, userId, page = '1', pageSize = '20' } = req.query;

    const skip = (parseInt(String(page)) - 1) * parseInt(String(pageSize));
    const take = parseInt(String(pageSize));

    const where: Record<string, unknown> = {};
    if (facilityId) where.facilityId = String(facilityId);
    if (userId) {
      where.OR = [
        { incarceratedPersonId: String(userId) },
        { familyMemberId: String(userId) },
      ];
    }
    if (startDate || endDate) {
      where.scheduledStart = {
        ...(startDate ? { gte: new Date(String(startDate)) } : {}),
        ...(endDate ? { lte: new Date(String(endDate)) } : {}),
      };
    }

    const [calls, total] = await Promise.all([
      prisma.videoCall.findMany({
        where,
        include: {
          incarceratedPerson: true,
          familyMember: true,
        },
        skip,
        take,
        orderBy: { scheduledStart: 'desc' },
      }),
      prisma.videoCall.count({ where }),
    ]);

    res.json({
      success: true,
      data: calls,
      pagination: {
        page: parseInt(String(page)),
        pageSize: take,
        total,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    console.error('Error fetching video call logs:', error);
    res.status(500).json(createErrorResponse({ code: 'INTERNAL_ERROR', message: 'Failed to fetch call logs' }));
  }
});

videoRouter.get('/pending-requests', requireAuth, requireRole('facility_admin', 'agency_admin'), async (req: Request, res: Response) => {
  try {
    const { facilityId } = req.query;

    const pendingRequests = await prisma.videoCall.findMany({
      where: {
        status: 'requested',
        ...(facilityId ? { facilityId: String(facilityId) } : {}),
      },
      include: {
        incarceratedPerson: true,
        familyMember: true,
      },
      orderBy: { scheduledStart: 'asc' },
    });

    res.json(createSuccessResponse(pendingRequests));
  } catch (error) {
    console.error('Error fetching pending requests:', error);
    res.status(500).json(createErrorResponse({ code: 'INTERNAL_ERROR', message: 'Failed to fetch pending requests' }));
  }
});

videoRouter.post('/approve-request/:callId', requireAuth, requireRole('facility_admin', 'agency_admin'), async (req: Request, res: Response) => {
  try {
    const { callId } = req.params;

    const call = await prisma.videoCall.update({
      where: { id: callId },
      data: {
        status: 'scheduled',
        approvedBy: req.user!.id,
      },
    });

    res.json(createSuccessResponse(call));
  } catch (error) {
    console.error('Error approving video call:', error);
    res.status(500).json(createErrorResponse({ code: 'INTERNAL_ERROR', message: 'Failed to approve video call' }));
  }
});

videoRouter.post('/deny-request/:callId', requireAuth, requireRole('facility_admin', 'agency_admin'), async (req: Request, res: Response) => {
  try {
    const { callId } = req.params;

    const call = await prisma.videoCall.update({
      where: { id: callId },
      data: { status: 'denied' },
    });

    res.json(createSuccessResponse(call));
  } catch (error) {
    console.error('Error denying video call:', error);
    res.status(500).json(createErrorResponse({ code: 'INTERNAL_ERROR', message: 'Failed to deny video call' }));
  }
});

videoRouter.post('/terminate-call/:callId', requireAuth, requireRole('facility_admin', 'agency_admin'), async (req: Request, res: Response) => {
  try {
    const { callId } = req.params;

    const call = await prisma.videoCall.update({
      where: { id: callId },
      data: {
        status: 'terminated_by_admin',
        actualEnd: new Date(),
        endedBy: 'admin',
        terminatedByAdminId: req.user!.id,
      },
    });

    res.json(createSuccessResponse(call));
  } catch (error) {
    console.error('Error terminating video call:', error);
    res.status(500).json(createErrorResponse({ code: 'INTERNAL_ERROR', message: 'Failed to terminate call' }));
  }
});

videoRouter.get('/stats', requireAuth, requireRole('facility_admin', 'agency_admin'), async (req: Request, res: Response) => {
  try {
    const { facilityId, date } = req.query;
    const targetDate = date ? new Date(String(date)) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const where: Record<string, unknown> = {};
    if (facilityId) where.facilityId = String(facilityId);

    const [activeCalls, todayTotal, pendingRequests] = await Promise.all([
      prisma.videoCall.count({
        where: { ...where, status: 'in_progress' },
      }),
      prisma.videoCall.count({
        where: {
          ...where,
          scheduledStart: { gte: startOfDay, lte: endOfDay },
        },
      }),
      prisma.videoCall.count({
        where: { ...where, status: 'requested' },
      }),
    ]);

    res.json(createSuccessResponse({ activeCalls, todayTotal, pendingRequests }));
  } catch (error) {
    console.error('Error fetching video stats:', error);
    res.status(500).json(createErrorResponse({ code: 'INTERNAL_ERROR', message: 'Failed to fetch stats' }));
  }
});

export default videoRouter;
