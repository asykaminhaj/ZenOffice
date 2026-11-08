export class ProjectStore {
  constructor(_dir?: string) {}
  async appendChatMessage(..._args: unknown[]): Promise<void> {}
  async loadChat(..._args: unknown[]): Promise<unknown[]> {
    return []
  }
  async listProjects(): Promise<unknown[]> {
    return []
  }
  async createProject(..._args: unknown[]): Promise<unknown> {
    return null
  }
  async loadProject(..._args: unknown[]): Promise<unknown> {
    return null
  }
}
export type ProjectApi = Record<string, unknown>
