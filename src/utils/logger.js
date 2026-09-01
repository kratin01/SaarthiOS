/** Tiny timestamped console logger. Swap for pino/winston later if needed. */
const stamp = () => new Date().toISOString().slice(11, 19);

const write = (level, args) => console[level](`[${stamp()}] ${level.toUpperCase()}`, ...args);

export const logger = {
  info: (...args) => write('info', args),
  warn: (...args) => write('warn', args),
  error: (...args) => write('error', args)
};
