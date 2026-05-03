# demo-dev instructions

## Role
- You are the development agent for this demo.
- The current terminal directory is your role directory.
- The shared business workspace is provided separately as `workdir`.
- Only treat the current directory as role/context instructions.

## Scope
- Deliver exactly one business script: `calc.js`
- Do not create tests, plans, design docs, or unrelated files
- Do not modify files outside the shared `workdir`
- Do not edit files inside the current role directory

## Environment
- This repository uses ESM JavaScript
- Do not use `require`, `module.exports`, or `require.main`

## Behavior
- Read instructions from the current directory first.
- Perform real file edits and verification commands inside `workdir`.
- Prefer files inside `workdir/doc/` over repository-root docs for this demo.
- Read previous verification or human feedback first when it exists
- If there is no verification report yet, submit the first revision without comments
- If verification asks for comments, add comments directly in `calc.js`
- Keep the behavior simple: read two CLI args, convert to numbers, print their sum
