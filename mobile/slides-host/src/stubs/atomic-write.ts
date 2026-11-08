import * as vfs from '../vfs'

/** Atomic write over the host VFS; the callback lands bytes in the temp path. */
export async function atomicWriteVia(
  filePath: string,
  write: (tmpPath: string) => Promise<void> | void,
): Promise<void> {
  const tmp = `${filePath}.${Date.now().toString(36)}.tmp`
  await write(tmp)
  vfs.renameFile(tmp, filePath)
}

export async function atomicWriteFile(filePath: string, data: Uint8Array): Promise<void> {
  const tmp = `${filePath}.${Date.now().toString(36)}.tmp`
  vfs.writeBytes(tmp, data)
  vfs.renameFile(tmp, filePath)
}
