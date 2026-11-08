export async function parseFileToText(): Promise<{ ok: false; error: string }> {
  return { ok: false, error: 'Attachments are not available on Android' }
}
