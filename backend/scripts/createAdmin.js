const mongoose = require('mongoose');
const { createInterface } = require('node:readline/promises');
const { readSecret } = require('./secretPrompt');
const { passwordInput, AuthError } = require('../src/auth/security');
const { MongoAuthStore } = require('../src/auth/store');
const { provisionAdmin, AdminProvisionError } = require('../src/admin/provision');
const User = require('../src/models/User');
async function main() {
  if (process.argv.slice(2).join(' ') !== '--production')
    throw new AdminProvisionError('Run npm run admin:create -- --production. No password/URI arguments are accepted.');
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new AdminProvisionError('Run this command in your own interactive terminal.');
  // Never load a local .env implicitly: ask explicitly or use the server environment.
  const uri = process.env.MONGO_URI || await readSecret('Production MongoDB URI (hidden): ');
  let location;
  try { location = new URL(uri); } catch { throw new AdminProvisionError('Enter a valid MongoDB URI.'); }
  if (!['mongodb:', 'mongodb+srv:'].includes(location.protocol))
    throw new AdminProvisionError('Enter a MongoDB URI.');
  let dbName = process.env.APP_DATABASE_NAME || decodeURIComponent(location.pathname.slice(1));
  if (!dbName) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try { dbName = (await prompt.question('Exact live database name (check Atlas/Render): ')).trim(); }
    finally { prompt.close(); }
  }
  if (!dbName || /[\s/\\.$\0]/.test(dbName))
    throw new AdminProvisionError('An explicit valid database name is required.');
  console.info(`Target host: ${location.hostname}; database: ${JSON.stringify(dbName)}. Creating only the admin account.`);
  const password = await readSecret('New admin password (15–128 characters, hidden): ');
  passwordInput(password);
  const repeated = await readSecret('Repeat admin password (hidden): ');
  if (password !== repeated) throw new AdminProvisionError('Passwords do not match. No account was created.');
  try {
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 10000 });
    await User.init();
    const result = await provisionAdmin(new MongoAuthStore(), password);
    console.info(result.created
      ? 'Created admin. Sign in with username admin and your chosen password. No email, phone or activation code is required.'
      : 'Admin already exists. Its password and history were not changed.');
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) main().catch(error => {
  console.error(error instanceof AdminProvisionError || error instanceof AuthError
    ? error.message : 'Admin setup failed. Check the private connection settings, Atlas network access and terminal input.');
  process.exitCode = 1;
});
module.exports = { main };
