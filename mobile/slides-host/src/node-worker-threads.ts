export class Worker {
  on() {
    return this
  }
  terminate(): Promise<number> {
    return Promise.resolve(0)
  }
  postMessage() {}
}
export class MessageChannel {
  port1 = {}
  port2 = {}
}
export function receiveMessageOnPort(): undefined {
  return undefined
}
export const workerData = undefined
export default { Worker, MessageChannel, receiveMessageOnPort, workerData }
