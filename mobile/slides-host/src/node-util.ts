export function promisify<T extends (...args: never[]) => unknown>(fn: T): T {
  return fn
}
export function inspect(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
export function format(...args: unknown[]): string {
  return args.map((a) => (typeof a === 'string' ? a : inspect(a))).join(' ')
}
export default { promisify, inspect, format }
