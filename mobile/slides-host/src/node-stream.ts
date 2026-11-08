/** Very small stream shim; the host overrides savePptxToFile so JSZip never streams. */
export class PassThrough {
  on(): this {
    return this
  }
  once(): this {
    return this
  }
  pipe<T>(target: T): T {
    return target
  }
  write(): boolean {
    return true
  }
  end(): void {}
  destroy(): void {}
}
export class Readable extends PassThrough {}
export class Writable extends PassThrough {}
export class Transform extends PassThrough {}
export default { PassThrough, Readable, Writable, Transform }
