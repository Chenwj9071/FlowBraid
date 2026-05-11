import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createRunId, nowIso, readJson, writeJson } from './utils.js';
import { RunState, RunTimelineEntry, RunWorkspace, WorkflowDefinition } from './types.js';

export async function createRunWorkspace(baseDir: string, workflow: WorkflowDefinition): Promise<RunWorkspace> {
  const runId = createRunId();
  const runDir = path.join(baseDir, runId);
  const workspace: RunWorkspace = {
    runId,
    runDir,
    manifestPath: path.join(runDir, 'manifest.json'),
    statePath: path.join(runDir, 'state', 'run.json'),
    timelinePath: path.join(runDir, 'state', 'timeline.json'),
    stateDir: path.join(runDir, 'state'),
    nodesDir: path.join(runDir, 'nodes'),
    artifactsDir: path.join(runDir, 'artifacts'),
    messagesDir: path.join(runDir, 'messages'),
    logsDir: path.join(runDir, 'logs'),
  };
  await initializeWorkspace(workspace, workflow);
  return workspace;
}

export async function initializeWorkspace(workspace: RunWorkspace, workflow: WorkflowDefinition): Promise<void> {
  await mkdir(workspace.runDir, { recursive: true });
  await mkdir(workspace.stateDir, { recursive: true });
  await mkdir(workspace.nodesDir, { recursive: true });
  await mkdir(workspace.artifactsDir, { recursive: true });
  await mkdir(workspace.messagesDir, { recursive: true });
  await mkdir(workspace.logsDir, { recursive: true });
  await writeJson(workspace.manifestPath, {
    workflow,
    createdAt: nowIso(),
  });
  await writeJson(workspace.timelinePath, []);
}

export async function createInitialState(workspace: RunWorkspace, workflow: WorkflowDefinition): Promise<RunState> {
  const state: RunState = {
    runId: workspace.runId,
    workflowId: workflow.id,
    status: 'running',
    currentNodeId: workflow.start,
    pendingNodeId: null,
    manualDecisionState: 'idle',
    manualDecisionNodeId: null,
    manualDecisionAttemptId: null,
    manualDecisionReason: null,
    resumeCount: 0,
    stepCount: 0,
    startedAt: nowIso(),
    updatedAt: nowIso(),
  };
  await persistRunState(workspace, state);
  return state;
}

export async function loadRunState(workspace: RunWorkspace): Promise<RunState> {
  return readJson<RunState>(workspace.statePath);
}

export async function persistRunState(workspace: RunWorkspace, state: RunState): Promise<void> {
  state.updatedAt = nowIso();
  await writeJson(workspace.statePath, state);
}

export async function readManifest(workspace: RunWorkspace): Promise<{ workflow: WorkflowDefinition; createdAt: string }> {
  return readJson(workspace.manifestPath);
}

export async function loadManifest(runDir: string): Promise<{
  workspace: RunWorkspace;
  manifest: { workflow: WorkflowDefinition; createdAt: string };
}> {
  const workspace: RunWorkspace = {
    runId: path.basename(runDir),
    runDir,
    manifestPath: path.join(runDir, 'manifest.json'),
    statePath: path.join(runDir, 'state', 'run.json'),
    timelinePath: path.join(runDir, 'state', 'timeline.json'),
    stateDir: path.join(runDir, 'state'),
    nodesDir: path.join(runDir, 'nodes'),
    artifactsDir: path.join(runDir, 'artifacts'),
    messagesDir: path.join(runDir, 'messages'),
    logsDir: path.join(runDir, 'logs'),
  };
  return {
    workspace,
    manifest: await readManifest(workspace),
  };
}

export async function loadRunTimeline(workspace: RunWorkspace): Promise<RunTimelineEntry[]> {
  return readJson<RunTimelineEntry[]>(workspace.timelinePath);
}

export async function persistRunTimeline(workspace: RunWorkspace, timeline: RunTimelineEntry[]): Promise<void> {
  await writeJson(workspace.timelinePath, timeline);
}
