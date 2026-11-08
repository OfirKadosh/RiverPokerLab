const { AuthError, checkPassword } = require("./security");
const { readCode } = require("./manualCode");
const { accessStatus } = require("./access");

const OWNER = "ofir";
const ADMIN = "admin";
const TEN_MINUTES = 600000;
const approved = user => !!(user?.accountApprovedAt || user?.emailVerifiedAt || user?.phoneVerifiedAt);
const protectedAccount = user => user.role === "admin" || user.usernameKey === OWNER;

const canGrantAccess = user => user.role !== "admin" && (approved(user) || !!user.trialStartedAt);

function approvalAvailable(user, now) {
  if (approved(user) || user.verificationDelivery !== "manual" || !user.verificationSentAt) return false;
  return +user.verificationSentAt + TEN_MINUTES <= +now && !(user.verificationExpiresAt > now);
}

function managementRoutes({ route, requireAccount, issueSwitch, identity, store, config, now, limit }) {
  route("/switch-account", async (req, res) => {
    const { user, record } = await requireAccount(req);
    if (user.restrictedAt) throw new AuthError(403, "This account is restricted.");
    let owner, admin;
    if (record.switchOwnerId && record.switchAdminId) {
      [owner, admin] = await Promise.all([
        store.getUser(record.switchOwnerId), store.getUser(record.switchAdminId),
      ]);
      if (owner?.usernameKey !== OWNER || owner.role === "admin" || owner.restrictedAt ||
          !(approved(owner) || owner.trialStartedAt) || admin?.usernameKey !== ADMIN || admin.role !== "admin" ||
          !approved(admin) || admin.restrictedAt)
        throw new AuthError(403, "Account switching is unavailable.");
    } else {
      if (user.usernameKey !== OWNER || user.role === "admin")
        throw new AuthError(403, "Account switching is unavailable.");
      if (typeof req.body?.adminPassword !== "string" || !req.body.adminPassword)
        throw new AuthError(400, "Enter the administrator password to link this session.");
      await limit("admin-switch-ip", req.ip, 10, 15 * 60000);
      await limit("admin-switch-account", String(user._id), 5, 15 * 60000);
      owner = user;
      admin = await store.findUser(ADMIN);
      const valid = await checkPassword(req.body.adminPassword, admin?.passwordHash);
      if (!valid || admin?.usernameKey !== ADMIN || admin.role !== "admin" ||
          !approved(admin) || admin.restrictedAt)
        throw new AuthError(403, "Invalid administrator password.");
    }
    const target = String(user._id) === String(owner._id) ? admin : owner;
    const next = await issueSwitch(req, res, record, target, owner, admin);
    res.json(identity(target, next));
  });

  async function requireAdmin(req) {
    const { user } = await requireAccount(req);
    if (user.role !== "admin" || user.restrictedAt)
      throw new AuthError(403, "Administrator access is required.");
    return user;
  }

  route("/admin/accounts", async (req, res) => {
    await requireAdmin(req);
    const after = req.body?.after;
    if (after !== undefined && (typeof after !== "string" || !/^[a-f0-9]{24}$/i.test(after)))
      throw new AuthError(400, "Invalid account cursor.");
    const instant = now();
    const users = await store.listAccounts(after, 51);
    res.json({
      success: true,
      serverTime: instant,
      next: users.length > 50 ? String(users[49]._id) : null,
      accounts: users.slice(0, 50).map(user => ({
        id: String(user._id),
        username: user.username,
        email: user.email || null,
        restricted: !!user.restrictedAt,
        protected: protectedAccount(user),
        approved: approved(user) || !!user.trialStartedAt,
        canGrantAccess: config.timeLimitedAccess === true && canGrantAccess(user),
        access: accessStatus(user, instant, config.timeLimitedAccess),
        canApprove: !protectedAccount(user) && approvalAvailable(user, instant),
        verification: !approved(user) && !user.trialStartedAt && user.verificationDelivery === "manual" ? {
          code: readCode(config.secret, user, instant),
          expiresAt: user.verificationExpiresAt || new Date(+user.verificationSentAt + TEN_MINUTES),
        } : null,
      })),
    });
  });

  route("/admin/account-action", async (req, res) => {
    const actor = await requireAdmin(req);
    const { userId, action } = req.body || {};
    if (typeof userId !== "string" || !/^[a-f0-9]{24}$/i.test(userId) ||
        !["approve", "grant-access", "restrict", "unrestrict", "delete"].includes(action))
      throw new AuthError(400, "Choose a valid account and action.");
    const target = await store.getUser(userId);
    if (!target) throw new AuthError(404, "Account not found.");
    const grant = action === "grant-access";
    if (grant ? !config.timeLimitedAccess || !canGrantAccess(target) : protectedAccount(target))
      throw new AuthError(403, "This action is unavailable for this account.");
    const instant = now();
    if (action === "approve" && !approvalAvailable(target, instant))
      throw new AuthError(409, "Manual approval is available after the verification window expires.");
    if (action === "delete" && req.body.confirmUsername !== target.username)
      throw new AuthError(400, "Confirm the exact username to delete this account.");
    if (!await store.manageAccount(userId, action, instant, config.timeLimitedAccess))
      throw new AuthError(409, "The account changed. Refresh and try again.");
    console.info(JSON.stringify({
      event: "admin_account_action", actorId: String(actor._id), userId, action,
    }));
    res.json({ success: true });
  });
}

module.exports = { managementRoutes, OWNER };
