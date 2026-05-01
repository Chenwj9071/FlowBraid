export class RunInterruptedError extends Error {
  constructor(message = 'run interrupted by user') {
    super(message);
    this.name = 'RunInterruptedError';
  }
}

export function isAbortSignalTriggered(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted);
}

