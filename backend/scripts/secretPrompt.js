// Interactive input only: secrets never enter shell arguments, history or console output.
function readSecret(label, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY)
    return Promise.reject(Error('Use an interactive terminal. Passwords are not accepted through command arguments or pipes.'));
  return new Promise((resolve, reject) => {
    const previousRaw = !!input.isRaw;
    let value = '';
    const finish = (error) => {
      input.off('data', receive); input.off('error', failure); input.off('end', ended);
      input.setRawMode(previousRaw); input.pause(); output.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const failure = () => finish(Error('Cannot read private input.'));
    const ended = () => finish(Error('Input closed. No changes made.'));
    const receive = chunk => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') { finish(Error('Cancelled.')); return; }
        if (character === '\r' || character === '\n') { finish(); return; }
        if (character === '\u007f' || character === '\b') value = [...value].slice(0, -1).join('');
        else if (character >= ' ') value += character;
        if (value.length > 8192) { finish(Error('Private input is too long.')); return; }
      }
    };
    output.write(label); input.setEncoding('utf8'); input.setRawMode(true); input.resume();
    input.on('data', receive); input.once('error', failure); input.once('end', ended);
  });
}
module.exports = { readSecret };
