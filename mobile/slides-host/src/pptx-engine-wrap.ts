/** Re-export the real engine, replacing the one Node-streaming save entry point. */
export * from '../../../packages/pptx-engine/src/index'
import { savePptx } from '../../../packages/pptx-engine/src/index'
import * as vfs from './vfs'

export async function savePptxToFile(
  opened: Parameters<typeof savePptx>[0],
  filePath: string,
): Promise<void> {
  const bytes = await savePptx(opened)
  vfs.writeBytes(filePath, bytes)
}
