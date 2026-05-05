export function parseArgs(argv: string[]): { command?: string; rest: string[]; flags: Record<string, string | boolean> } {
  const [command, ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];
    if (item.startsWith('--')) {
      const key = item.slice(2);
      const value = rest[i + 1];
      if (!value || value.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = value;
        i += 1;
      }
    } else {
      positional.push(item);
    }
  }
  return { command, rest: positional, flags };
}
