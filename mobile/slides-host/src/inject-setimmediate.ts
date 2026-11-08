export const setImmediate = (fn: (...args: unknown[]) => void, ...args: unknown[]) =>
  setTimeout(() => fn(...args), 0) as unknown as number
export const clearImmediate = (id: number) => clearTimeout(id)
