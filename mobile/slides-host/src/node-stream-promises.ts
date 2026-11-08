export async function pipeline(_source: unknown, _target: unknown): Promise<void> {
  throw new Error('streaming writes are unavailable on Android; use savePptxToFile instead')
}
export const finished = pipeline
export default { pipeline, finished }
