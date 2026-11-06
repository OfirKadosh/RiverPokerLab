const { passwordInput, hashPassword } = require('../auth/security');
class AdminProvisionError extends Error {}
async function provisionAdmin(store, password) {
  const existing = await store.findUser('admin');
  if (existing) {
    if (existing.role !== 'admin')
      throw new AdminProvisionError('The admin username belongs to an existing non-admin account. No account was changed.');
    return { created: false };
  }
  passwordInput(password);
  const data = {
    username: 'admin', usernameKey: 'admin', role: 'admin',
    passwordHash: await hashPassword(password), accountApprovedAt: new Date(),
  };
  try { await store.createUser(data); }
  catch (error) {
    if (error.code === 11000) {
      const current = await store.findUser('admin');
      if (current?.role === 'admin') return { created: false };
      throw new AdminProvisionError('A unique account/contact record conflicts. No existing account was changed.');
    }
    throw error;
  }
  return { created: true };
}
module.exports = { provisionAdmin, AdminProvisionError };
