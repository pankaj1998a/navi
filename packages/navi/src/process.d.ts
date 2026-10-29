declare namespace NodeJS {
  interface Process {
    removeListener(event: string | symbol, listener: (...args: any[]) => void): this
    off(event: string | symbol, listener: (...args: any[]) => void): this
  }
}
