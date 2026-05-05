import {
  createWindowsTerminalLauncher,
  buildWindowsTerminalCloseCommand,
  buildWindowsTerminalLaunchCommand,
  parseTerminalPid,
} from './windows.js';
import type { ExternalTerminalLauncher } from './types.js';

export { buildWindowsTerminalCloseCommand, buildWindowsTerminalLaunchCommand, parseTerminalPid };
export type { ExternalTerminalLaunchRequest, ExternalTerminalLaunchResult, ExternalTerminalLauncher } from './types.js';

export function createExternalTerminalLauncher(platform: NodeJS.Platform = process.platform): ExternalTerminalLauncher {
  if (platform === 'win32') {
    return createWindowsTerminalLauncher();
  }

  return {
    async launch(): Promise<never> {
      throw new Error('split-terminal mode currently supports Windows only');
    },
    async close(): Promise<void> {
      throw new Error('split-terminal mode currently supports Windows only');
    },
  };
}
