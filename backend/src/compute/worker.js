const { parentPort } = require('node:worker_threads');
const { executeTask } = require('./tasks');
parentPort.on('message', ({ id, kind, input }) => {
  try {
    parentPort.postMessage({ id, result: executeTask(kind, input, {onProgress: progress => parentPort.postMessage({id, progress})}) });
  } catch (error) {
    parentPort.postMessage({ id, error: {
      name: error.name,
      message: error.name === 'ValidationError' ? error.message : 'Calculation failed. Try a smaller spot or fewer samples.',
    } });
  }
});
