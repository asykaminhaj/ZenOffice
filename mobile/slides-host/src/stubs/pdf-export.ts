export async function exportSlidesPdf(): Promise<{ ok: false; error: string }> {
  return { ok: false, error: 'PDF export is not available on Android yet' }
}
