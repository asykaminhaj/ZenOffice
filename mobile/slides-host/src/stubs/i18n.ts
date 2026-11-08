const LANGS = ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'th', 'id', 'ru', 'ar']
export function normalizeLang(value: unknown): string {
  const l = String(value || '').slice(0, 2).toLowerCase()
  return LANGS.includes(l) ? l : 'en'
}
export function getUiLang(): string {
  try {
    const stored = localStorage.getItem('genoffice.android.lang')
    return normalizeLang(stored ? JSON.parse(stored) : navigator.language || 'id')
  } catch {
    return 'en'
  }
}
export function setUiLang(_lang: string): void {}
export function createI18n<T>(table: T): (key: string) => string {
  return (key: string) => {
    const row = (table as Record<string, Record<string, string>>)[key]
    return row?.en ?? row?.id ?? key
  }
}
