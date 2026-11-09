const User = require("../models/User");
const { BankrollError, MAX_ENTRIES } = require("./ledger");

function createBankrollStore(model = User) {
  async function get(ownerId) {
    const user = await model.findById(ownerId).select({ bankroll: 1, _id: 0 }).lean();
    return user?.bankroll ?? null;
  }

  async function update(filter, mutation) {
    const user = await model.findOneAndUpdate(filter, mutation, {
      returnDocument: "after",
      projection: { bankroll: 1, _id: 0 },
      timestamps: false,
    }).lean();
    return user?.bankroll ?? null;
  }

  return {
    get,
    async configure(ownerId, { currency, openingBalance }) {
      const bankroll = await update({
        _id: ownerId,
        $or: [{ "bankroll.currency": { $exists: false } }, { "bankroll.currency": currency }],
      }, { $set: { "bankroll.currency": currency, "bankroll.openingBalance": openingBalance } });
      if (!bankroll) throw new BankrollError(409, "The currency cannot be changed after setup.");
      return bankroll;
    },
    async add(ownerId, entry) {
      const bankroll = await update({
        _id: ownerId,
        "bankroll.currency": { $exists: true },
        "bankroll.entries.id": { $ne: entry.id },
        [`bankroll.entries.${MAX_ENTRIES - 1}`]: { $exists: false },
      }, { $push: { "bankroll.entries": { $each: [entry], $position: 0 } } });
      if (bankroll) return bankroll;
      const current = await get(ownerId);
      if (!current) throw new BankrollError(409, "Set up the bankroll first.");
      const existing = current.entries?.find((item) => item.id === entry.id);
      if (existing && Object.keys(entry).every((key) => existing[key] === entry[key])) return current;
      if (existing) throw new BankrollError(409, "This entry ID has already been used.");
      throw new BankrollError(409, "The ledger is full or changed. Refresh and try again.");
    },
    async edit(ownerId, entry) {
      const bankroll = await update(
        { _id: ownerId, "bankroll.entries.id": entry.id },
        { $set: { "bankroll.entries.$": entry } },
      );
      if (!bankroll) throw new BankrollError(404, "Entry not found.");
      return bankroll;
    },
    async remove(ownerId, id) {
      const bankroll = await update(
        { _id: ownerId, "bankroll.entries.id": id },
        { $pull: { "bankroll.entries": { id } } },
      );
      if (!bankroll) throw new BankrollError(404, "Entry not found.");
      return bankroll;
    },
  };
}

module.exports = { createBankrollStore };
