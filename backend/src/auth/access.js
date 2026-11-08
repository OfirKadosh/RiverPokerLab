const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_DAYS = 7;
const GRANT_DAYS = 30;

function trialAccess(now) {
  return {
    trialStartedAt: now,
    accessUntil: new Date(+now + TRIAL_DAYS * DAY_MS),
    accessSource: "trial",
  };
}

function grantedAccess(now) {
  return {
    accessUntil: new Date(+now + GRANT_DAYS * DAY_MS),
    accessSource: "admin",
  };
}

function accessStatus(user, now, timeLimitedAccess) {
  if (user.role === "admin") return;
  let expiresAt = user.accessUntil;
  let source = user.accessSource;
  if (!expiresAt && user.trialStartedAt) {
    expiresAt = trialAccess(user.trialStartedAt).accessUntil;
    source = "trial";
  }
  if (!expiresAt && timeLimitedAccess) {
    const approval = user.accountApprovedAt || user.emailVerifiedAt || user.phoneVerifiedAt;
    if (approval) {
      expiresAt = grantedAccess(approval).accessUntil;
      source = "legacy";
    }
  }
  if (!expiresAt) return;
  return {
    source,
    expiresAt,
    expiresInMs: Math.max(0, +expiresAt - +now),
    expired: +expiresAt <= +now,
  };
}

module.exports = { TRIAL_DAYS, trialAccess, grantedAccess, accessStatus };
