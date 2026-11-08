/** Main-process strings in the Android host; English keys are enough for errors/dialogs. */
const TEXT: Record<string, string> = {
  untitledDeck: 'Untitled presentation',
  errInsertFailed: 'Insert failed',
  errSaveFailed: 'Save failed',
  dlgInsertImage: 'Insert image',
  dlgReplacePicture: 'Replace picture',
  dlgInsertVideo: 'Insert video',
  dlgInsertAudio: 'Insert audio',
  dlgInsert3d: 'Insert 3D model',
  dlgPickExportDir: 'Export folder',
  dlgExportPdf: 'Export as PDF',
  dlgSavePicture: 'Save as picture',
}
export function tm(key: string): string {
  return TEXT[key] ?? key
}
export function tMain(key: string): string {
  return tm(key)
}
