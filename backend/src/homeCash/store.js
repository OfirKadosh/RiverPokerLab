const mongoose = require("mongoose");

const gameSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  ownerId: { type: String, required: true },
  status: { type: String, enum: ["active", "closed", "cancelled"], required: true },
  openingFingerprint: { type: String, required: true },
  version: { type: Number, required: true },
  updatedAt: { type: Date, required: true },
  name: { type: String, required: true },
  buyIn: { type: Number, required: true },
  chipsPerBuyIn: { type: Number, required: true },
  createdAt: { type: Date, required: true },
  players: [mongoose.Schema.Types.Mixed],
  entries: [mongoose.Schema.Types.Mixed],
  operations: [mongoose.Schema.Types.Mixed],
  settlement: mongoose.Schema.Types.Mixed,
}, { versionKey: false });
gameSchema.index({ ownerId: 1 }, { unique: true, partialFilterExpression: { status: "active" } });
gameSchema.index({ ownerId: 1, status: 1, updatedAt: -1 });

const HomeCashGame = mongoose.model("HomeCashGame", gameSchema);

function mongoHomeCashStore(model = HomeCashGame) {
  return {
    find(ownerId, id) {
      return model.findOne({ _id: id, ownerId }).lean();
    },
    latest(ownerId, status) {
      return model.findOne({ ownerId, status }).sort({ updatedAt: -1 }).lean();
    },
    async insert(game) {
      await model.init();
      try {
        await model.create(game);
        return true;
      } catch (error) {
        if (error.code === 11000) return false;
        throw error;
      }
    },
    async replace(previous, next) {
      const result = await model.replaceOne({
        _id: previous._id, ownerId: previous.ownerId, version: previous.version,
      }, next);
      return result.modifiedCount === 1;
    },
  };
}

function memoryHomeCashStore() {
  const games = new Map();
  const store = {
    async find(ownerId, id) {
      const game = games.get(id);
      return game?.ownerId === ownerId ? structuredClone(game) : null;
    },
    async latest(ownerId, status) {
      return structuredClone([...games.values()]
        .filter((game) => game.ownerId === ownerId && game.status === status)
        .sort((a, b) => b.updatedAt - a.updatedAt).at(0) ?? null);
    },
    async insert(game) {
      if (games.has(game._id) ||
          [...games.values()].some((item) => item.ownerId === game.ownerId && item.status === "active")) return false;
      games.set(game._id, structuredClone(game));
      return true;
    },
    async replace(previous, next) {
      const game = games.get(previous._id);
      if (game?.ownerId !== previous.ownerId || game.version !== previous.version) return false;
      games.set(previous._id, structuredClone(next));
      return true;
    },
  };
  return store;
}

module.exports = { mongoHomeCashStore, memoryHomeCashStore };
