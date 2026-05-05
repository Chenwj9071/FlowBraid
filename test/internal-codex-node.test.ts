import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorkflowFile } from '../src/workflow.js';
import { createInitialState, createRunWorkspace, loadManifest } from '../src/workspace.js';
import { runInternalCodexNode } from '../src/internal-codex-node.js';
import { getExternalSessionPath, readExternalSessionState } from '../src/external-session.js';

async function createFakeInternalCodex(binDir: string): Promise<string> {
  const fakeScript = [
    "const fs = require('node:fs');",
    "const cp = require('node:child_process');",
    "const path = require('node:path');",
    '',
    'function parseArgs(argv) {',
    "  const result = { outputPath: '', workdir: process.cwd() };",
    '  for (let i = 0; i < argv.length; i += 1) {',
    '    const arg = argv[i];',
    "    if (arg === '--output-last-message') {",
    '      result.outputPath = argv[i + 1] || "";',
    '      i += 1;',
    '      continue;',
    '    }',
    "    if (arg === '--cd') {",
    '      result.workdir = argv[i + 1] || process.cwd();',
      '      i += 1;',
      '      continue;',
      '    }',
      '  }',
      '  return result;',
      '}',
      '',
      'const args = process.argv.slice(2);',
      'const parsed = parseArgs(args);',
      "const mode = process.env.FLOWBRAID_CODEX_MODE || 'exec';",
      "const calcPath = path.join(parsed.workdir, 'calc.js');",
      "fs.mkdirSync(parsed.workdir, { recursive: true });",
      "fs.writeFileSync(calcPath, 'console.log(Number(process.argv[2]) + Number(process.argv[3]));\\n', 'utf8');",
      "if (mode === 'review') {",
      "  const output = cp.execFileSync(process.execPath, [calcPath, '1', '2'], { cwd: parsed.workdir, encoding: 'utf8' }).trim();",
      "  const report = ['# verify report', `case 1 2 => ${output}`, 'verdict: approve'].join('\\n');",
      "  fs.writeFileSync(parsed.outputPath, report, 'utf8');",
      '} else {',
      "  fs.writeFileSync(parsed.outputPath, '# develop complete', 'utf8');",
      '}',
      "console.log('fake internal codex ok');",
    ].join('\n');

  const scriptPath = path.join(binDir, 'fake-internal-codex.js');
  const cmdPath = path.join(binDir, 'codex.cmd');
  await writeFile(scriptPath, fakeScript, 'utf8');
  await writeFile(cmdPath, `@echo off\r\nnode "${scriptPath}" %*\r\n`, 'utf8');
  return cmdPath;
}

async function createPromptCapturingCodex(binDir: string): Promise<string> {
  const fakeScript = [
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    "const outputIndex = args.indexOf('--output-last-message');",
    "const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : '';",
    "const prompt = fs.readFileSync(0, 'utf8');",
    "if (outputPath) fs.writeFileSync(outputPath, prompt, 'utf8');",
    "console.log('captured prompt');",
  ].join('\n');

  const scriptPath = path.join(binDir, 'fake-prompt-capture-codex.js');
  const cmdPath = path.join(binDir, 'codex.cmd');
  await writeFile(scriptPath, fakeScript, 'utf8');
  await writeFile(cmdPath, `@echo off\r\nnode "${scriptPath}" %*\r\n`, 'utf8');
  return cmdPath;
}

async function createPathRecordingCodex(binDir: string): Promise<string> {
  const fakeScript = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const args = process.argv.slice(2);",
    "const outputIndex = args.indexOf('--output-last-message');",
    "const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : '';",
    "const payload = {",
    "  cwd: process.cwd(),",
    "  argv: args,",
    "  flowbraidWorkdir: process.env.FLOWBRAID_WORKDIR || '',",
    "  flowbraidContextDir: process.env.FLOWBRAID_CONTEXT_DIR || '',",
    "};",
    "if (outputPath) fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');",
    "console.log('recorded native path');",
  ].join('\n');

  const scriptPath = path.join(binDir, 'fake-path-recording-codex.js');
  const cmdPath = path.join(binDir, 'codex.cmd');
  await writeFile(scriptPath, fakeScript, 'utf8');
  await writeFile(cmdPath, `@echo off\r\nnode "${scriptPath}" %*\r\n`, 'utf8');
  return cmdPath;
}

describe('internal codex node runner', () => {
  it('executes a develop node and writes a completed external session state', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-internal-node-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const binDir = path.join(tempRoot, 'bin');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    const codexCommand = await createFakeInternalCodex(binDir);

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflowText = `
id: split-demo
workdir: .
start: develop
nodes:
  develop:
    type: codex
    mode: exec
    prompt: implement calc
    outputFile: develop.md
    next: verify
  verify:
    type: codex
    mode: review
    prompt: verify calc
    outputFile: verify-report.md
    transitions:
      success: done
      failure: develop
  done:
    type: end
    message: done
`;
    await writeFile(workflowFile, workflowText, 'utf8');

    const workflow = await loadWorkflowFile(workflowFile);
    const runWorkspace = await createRunWorkspace(workspaceRoot, workflow);
    await createInitialState(runWorkspace, workflow);

    const result = await runInternalCodexNode({
      runDir: runWorkspace.runDir,
      nodeId: 'develop',
      codexCommand,
    });

    expect(result.status).toBe('completed');

    const nodeDir = path.join(runWorkspace.nodesDir, 'develop');
    const sessionState = await readExternalSessionState(getExternalSessionPath(nodeDir));
    expect(sessionState.status).toBe('completed');
    expect(sessionState.exitCode).toBe(0);

    const calcScript = await readFile(path.join(workflowDir, 'calc.js'), 'utf8');
    expect(calcScript).toContain('Number(process.argv[2])');
  });

  it('executes a review node and marks completed based on verdict', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-internal-node-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const binDir = path.join(tempRoot, 'bin');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    const codexCommand = await createFakeInternalCodex(binDir);

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflowText = `
id: split-demo
workdir: .
start: verify
nodes:
  verify:
    type: codex
    mode: review
    prompt: verify calc
    outputFile: verify-report.md
    transitions:
      success: done
      failure: verify
  done:
    type: end
    message: done
`;
    await writeFile(workflowFile, workflowText, 'utf8');

    const workflow = await loadWorkflowFile(workflowFile);
    const runWorkspace = await createRunWorkspace(workspaceRoot, workflow);
    await createInitialState(runWorkspace, workflow);

    const { manifest } = await loadManifest(runWorkspace.runDir);
    expect(manifest.workflow.nodes.verify.type).toBe('codex');

    const result = await runInternalCodexNode({
      runDir: runWorkspace.runDir,
      nodeId: 'verify',
      codexCommand,
    });

    expect(result.status).toBe('completed');

    const nodeDir = path.join(runWorkspace.nodesDir, 'verify');
    const sessionState = await readExternalSessionState(getExternalSessionPath(nodeDir));
    expect(sessionState.status).toBe('completed');

    const report = await readFile(path.join(nodeDir, 'artifacts', 'verify-report.md'), 'utf8');
    expect(report).toContain('verdict: approve');
  });

  it('injects latest verify and human feedback context into develop prompts', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-internal-node-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const binDir = path.join(tempRoot, 'bin');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    const codexCommand = await createPromptCapturingCodex(binDir);

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflowText = `
id: split-demo
workdir: .
start: develop
nodes:
  develop:
    type: codex
    mode: exec
    prompt: implement calc
    outputFile: develop.md
    next: done
  done:
    type: end
    message: done
`;
    await writeFile(workflowFile, workflowText, 'utf8');

    const workflow = await loadWorkflowFile(workflowFile);
    const runWorkspace = await createRunWorkspace(workspaceRoot, workflow);
    await createInitialState(runWorkspace, workflow);

    const verifyArtifactsDir = path.join(runWorkspace.nodesDir, 'verify', 'artifacts');
    await mkdir(verifyArtifactsDir, { recursive: true });
    await writeFile(
      path.join(verifyArtifactsDir, 'verify-report.md'),
      ['verdict: reject', 'Comments are missing. Add a clear comment in calc.js.', ''].join('\n'),
      'utf8',
    );
    await writeFile(
      path.join(runWorkspace.messagesDir, 'human-feedback.jsonl'),
      `${JSON.stringify({
        decision: 'reject',
        comment: '请补充一条命令行使用说明，并确认注释足够清晰。',
        at: '2026-05-04T00:00:00.000Z',
        nodeId: 'approve',
      })}\n`,
      'utf8',
    );

    const result = await runInternalCodexNode({
      runDir: runWorkspace.runDir,
      nodeId: 'develop',
      codexCommand,
    });

    expect(result.status).toBe('completed');

    const capturedPrompt = await readFile(path.join(runWorkspace.nodesDir, 'develop', 'artifacts', 'develop.md'), 'utf8');
    expect(capturedPrompt).toContain('latest.verify.report:');
    expect(capturedPrompt).toContain('verdict: reject');
    expect(capturedPrompt).toContain('Comments are missing');
    expect(capturedPrompt).toContain('latest.human.feedback:');
    expect(capturedPrompt).toContain('decision: reject');
    expect(capturedPrompt).toContain('请补充一条命令行使用说明');
  });

  it('uses the native interactive path under TTY conditions and still runs against contextDir/workdir correctly', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-internal-node-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const binDir = path.join(tempRoot, 'bin');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    const contextDir = path.join(workflowDir, 'context');
    const workdir = path.join(workflowDir, 'shared-workdir');
    await mkdir(workflowDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await mkdir(contextDir, { recursive: true });
    await mkdir(workdir, { recursive: true });
    const codexCommand = await createPathRecordingCodex(binDir);

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflowText = `
id: split-demo
workdir: ./shared-workdir
contextDir: ./context
start: develop
nodes:
  develop:
    type: codex
    mode: exec
    prompt: implement calc
    outputFile: develop.json
    next: done
  done:
    type: end
    message: done
`;
    await writeFile(workflowFile, workflowText, 'utf8');

    const workflow = await loadWorkflowFile(workflowFile);
    const runWorkspace = await createRunWorkspace(workspaceRoot, workflow);
    await createInitialState(runWorkspace, workflow);

    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });

    try {
      const result = await runInternalCodexNode({
        runDir: runWorkspace.runDir,
        nodeId: 'develop',
        codexCommand,
      });

      expect(result.status).toBe('completed');
      const marker = await readFile(path.join(runWorkspace.nodesDir, 'develop', 'artifacts', 'develop.json'), 'utf8');
      const payload = JSON.parse(marker) as {
        cwd: string;
        argv: string[];
        flowbraidWorkdir: string;
        flowbraidContextDir: string;
      };
      expect(payload.cwd).toBe(contextDir);
      expect(payload.flowbraidContextDir).toBe(contextDir);
      expect(payload.flowbraidWorkdir).toBe(workdir);
      expect(payload.argv).toContain('--cd');
      expect(payload.argv).toContain(workdir);
    } finally {
      restoreProperty(process.stdin, 'isTTY', stdinDescriptor);
      restoreProperty(process.stdout, 'isTTY', stdoutDescriptor);
    }
  });
});

function restoreProperty<T extends object, K extends keyof T>(
  target: T,
  key: K,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
    return;
  }
  delete (target as Record<PropertyKey, unknown>)[key as PropertyKey];
}
