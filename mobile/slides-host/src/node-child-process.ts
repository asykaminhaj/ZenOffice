export function execFile(
  _file: string,
  _args: string[],
  _opts: unknown,
  cb?: (err: Error | null, stdout: string, stderr: string) => void,
): void {
  const done = typeof _opts === 'function' ? (_opts as typeof cb) : cb
  if (done) queueMicrotask(() => done(new Error('child processes are unavailable on Android'), '', ''))
}

export function execFileSync(): never {
  throw new Error('child processes are unavailable on Android')
}

export default { execFile, execFileSync }
