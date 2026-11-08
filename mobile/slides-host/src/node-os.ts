export function tmpdir(): string {
  return '.genoffice/tmp'
}
export function homedir(): string {
  return '.genoffice/home'
}
export function platform(): string {
  return 'android'
}
export function type(): string {
  return 'Linux'
}
export function release(): string {
  return 'android'
}
export function cpus(): unknown[] {
  return []
}
export function totalmem(): number {
  return 0
}
export function freemem(): number {
  return 0
}
export default { tmpdir, homedir, platform, type, release, cpus, totalmem, freemem }
