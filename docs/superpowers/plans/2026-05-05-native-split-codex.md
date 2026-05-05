# Native Split Codex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new native split-terminal mode where codex nodes run in standalone native codex windows and report status back to the main FlowBraid process through explicit `flowbraid node ...` commands.

**Architecture:** Keep existing PTY and existing split-terminal behavior unchanged. Add a parallel native-split path with its own session state, CLI node protocol, terminal launch command builder, engine watcher, and demo workflow. The main process will only react to node protocol events and will never infer success from codex process exit.

**Tech Stack:** Node.js, TypeScript, Vitest, PowerShell, existing FlowBraid CLI/runtime

---

### Task 1: Add native split mode flags and types

**Files:**
- Modify: `src/types.ts`
- Modify: `src/cli-args.ts`
- Test: `test/cli-split-terminal.test.ts`

- [ ] **Step 1: Write the failing test**

Add assertions to `test/cli-split-terminal.test.ts` for:
- `run ... --native-split-terminals`
- `node complete --run-dir ... --node-id ...`

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli-split-terminal.test.ts`
Expected: FAIL because the new flag/command shape is not parsed yet

- [ ] **Step 3: Write minimal implementation**

Update:
- `src/types.ts` to add `nativeSplitTerminals?: boolean`
- `src/cli-args.ts` only as needed if current parser behavior needs new expectations

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/cli-split-terminal.test.ts`
Expected: PASS

### Task 2: Add native node session state and protocol writers

**Files:**
- Modify: `src/types.ts`
- Create: `src/native-session.ts`
- Test: `test/native-session.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/native-session.test.ts` covering:
- write/read `native-session.json`
- append `node.native.completed` event
- repeated terminal state update preserves latest snapshot

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/native-session.test.ts`
Expected: FAIL because module/functions do not exist

- [ ] **Step 3: Write minimal implementation**

Create `src/native-session.ts` with:
- `getNativeSessionPath(nodeDir)`
- `readNativeSessionState(path)`
- `writeNativeSessionState(path, state)`
- `appendNativeNodeEvent(messagesDir, payload)`

Add matching types in `src/types.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/native-session.test.ts`
Expected: PASS

### Task 3: Add `flowbraid node ...` CLI protocol commands

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/workspace.ts`
- Modify: `src/utils.ts` if needed
- Test: `test/native-node-cli.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/native-node-cli.test.ts` covering:
- `node start`
- `node complete`
- `node fail`
- `node artifact`

Each test should assert:
- `native-session.json` snapshot updated
- `messages/events.jsonl` contains the correct protocol event

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/native-node-cli.test.ts`
Expected: FAIL because `flowbraid node ...` subcommands do not exist

- [ ] **Step 3: Write minimal implementation**

Add a `node` top-level command in `src/cli.ts` that:
- loads `runDir`
- resolves `nodeDir`
- writes protocol state via `src/native-session.ts`
- appends structured audit events

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/native-node-cli.test.ts`
Expected: PASS

### Task 4: Build native codex launch commands

**Files:**
- Modify: `src/terminal-launchers/types.ts`
- Modify: `src/terminal-launchers/windows.ts`
- Test: `test/terminal-launcher.test.ts`

- [ ] **Step 1: Write the failing test**

Add a launcher test for native split mode that expects:
- window command launches raw `codex`
- prompt/bootstrap command is passed without `internal run-codex-node`
- working directory is `contextDir`

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/terminal-launcher.test.ts`
Expected: FAIL because launcher only supports current helper style

- [ ] **Step 3: Write minimal implementation**

Extend terminal launcher request shape to support:
- optional bootstrap command text
- native codex invocation arguments

Add Windows builder that launches a new PowerShell window and runs a bootstrap script which:
- sets UTF-8
- changes to `contextDir`
- starts native `codex`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/terminal-launcher.test.ts`
Expected: PASS

### Task 5: Add prompt contract builder for native split codex nodes

**Files:**
- Modify: `src/codex-prompt.ts`
- Test: `test/native-split-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/native-split-prompt.test.ts` asserting native split prompts include:
- run/node/context/workdir metadata
- explicit `flowbraid node complete/fail/artifact` commands
- verify/human feedback inlined when available

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/native-split-prompt.test.ts`
Expected: FAIL because prompt builder has no native split protocol section

- [ ] **Step 3: Write minimal implementation**

Extend prompt builder with a mode-specific protocol appendix for `native-split`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/native-split-prompt.test.ts`
Expected: PASS

### Task 6: Implement engine watcher for native split codex nodes

**Files:**
- Modify: `src/engine.ts`
- Modify: `src/types.ts`
- Modify: `src/executors/codex.ts` only if shared command helpers are needed
- Test: `test/native-split-engine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/native-split-engine.test.ts` covering:
- engine launches native split terminal
- engine waits for `node complete`
- engine closes terminal and flows to next node
- engine treats closed/no-terminal-report as failure

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/native-split-engine.test.ts`
Expected: FAIL because engine has no native split path

- [ ] **Step 3: Write minimal implementation**

Add a new codex-node branch in `src/engine.ts`:
- if `nativeSplitTerminals` use new launch path
- wait for `native-session.json` terminal state
- derive workflow outcome from node mode and artifacts
- close the terminal from main process after terminal state reaches a final protocol status

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/native-split-engine.test.ts`
Expected: PASS

### Task 7: Add native split demo workflow and script

**Files:**
- Create: `examples/codex-native-split-demo.workflow.yaml`
- Create: `scripts/demo-native-split.ps1`
- Modify: `package.json`
- Test: `test/codex-native-split-demo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/codex-native-split-demo.test.ts` mirroring the current split demo behavior:
- first verify reject for missing comments
- develop revises
- verify approve
- approval reject with comment
- develop revises
- verify approve
- approval approve

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/codex-native-split-demo.test.ts`
Expected: FAIL because demo files and mode do not exist

- [ ] **Step 3: Write minimal implementation**

Add:
- workflow file
- PowerShell launcher script
- npm script `demo:native-split`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/codex-native-split-demo.test.ts`
Expected: PASS

### Task 8: Verify mode isolation from PTY path

**Files:**
- Modify: `test/codex-pty-interactive.test.ts` only if a guard assertion is needed
- Run existing tests only

- [ ] **Step 1: Run PTY regression suite**

Run: `npx vitest run test/codex-pty-interactive.test.ts test/cli-interactive-approval.test.ts`
Expected: PASS

- [ ] **Step 2: If needed, add a guard assertion**

Only if a regression is found, add a test that PTY mode does not use native split protocol commands.

- [ ] **Step 3: Re-run PTY regression suite**

Run: `npx vitest run test/codex-pty-interactive.test.ts test/cli-interactive-approval.test.ts`
Expected: PASS

### Task 9: Full verification and real demo run

**Files:**
- Modify: none unless failures force targeted fixes

- [ ] **Step 1: Run focused native split suite**

Run:
`npx vitest run test/native-session.test.ts test/native-node-cli.test.ts test/native-split-prompt.test.ts test/native-split-engine.test.ts test/codex-native-split-demo.test.ts`
Expected: PASS

- [ ] **Step 2: Run full typecheck**

Run:
`npm run check`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run:
`npm test`
Expected: PASS

- [ ] **Step 4: Run real demo manually**

Run:
`npm run demo:native-split`

Verify:
- main process remains in current terminal
- codex node windows open separately
- node windows run native codex
- main process reaches approval
- `approve/reject` works to completion

- [ ] **Step 5: Summarize residual risks**

Document any remaining Windows-specific caveats, especially around terminal quoting and manual interruption.
