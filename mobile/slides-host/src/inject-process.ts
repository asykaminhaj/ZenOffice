export const process = {
  env: { NODE_ENV: 'production' } as Record<string, string | undefined>,
  platform: 'android',
  arch: 'arm64',
  versions: { node: '22.0.0' },
  version: 'v22.0.0',
  cwd: () => '.',
  nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args)),
  on: () => {},
  once: () => {},
  off: () => {},
  emit: () => false,
  listeners: () => [],
  memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0 }),
  hrtime: Object.assign(
    (previous?: [number, number]) => {
      const ms = performance.now()
      const sec = Math.floor(ms / 1000)
      const nsec = Math.floor((ms % 1000) * 1e6)
      return previous ? [sec - previous[0], nsec - previous[1]] : [sec, nsec]
    },
    { bigint: () => BigInt(Math.floor(performance.now() * 1e6)) },
  ),
  stdout: { write: () => true, isTTY: false },
  stderr: { write: () => true, isTTY: false },
  argv: [],
  execPath: '',
  pid: 1,
  getuid: () => 0,
}
