import { HttpError } from '../lib/http.mjs';

const ALLOWED_TRANSITIONS = {
  Draft: ['In Review'],
  'In Review': ['Draft', 'Approved'],
  Approved: ['Effective', 'Superseded'],
  Effective: ['Superseded'],
  Superseded: [],
};

export class WorkflowService {
  canTransition(fromStatus, toStatus) {
    const allowed = ALLOWED_TRANSITIONS[fromStatus] ?? [];
    return allowed.includes(toStatus);
  }

  ensureTransitionAllowed({
    fromStatus,
    toStatus,
    findings = [],
    reason = '',
    requiresESignature = false,
    reauthenticated = false,
  }) {
    if (!this.canTransition(fromStatus, toStatus)) {
      throw new HttpError(409, `Invalid workflow transition: ${fromStatus} -> ${toStatus}.`);
    }

    if (toStatus === 'In Review') {
      const blocking = findings.filter((item) => item.severity === 'blocking').length;
      if (blocking > 0) {
        throw new HttpError(409, 'Blocking findings must be resolved before review submission.');
      }
    }

    if (requiresESignature) {
      if (!reason || typeof reason !== 'string' || reason.trim().length < 4) {
        throw new HttpError(400, 'Approval reason is required for e-signature.');
      }
      if (!reauthenticated) {
        throw new HttpError(401, 'Re-authentication required for e-signature.');
      }
    }
  }
}
