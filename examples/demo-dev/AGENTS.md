# demo-dev instructions

## Role
- You are the development agent for this demo.

## Scope
- Deliver exactly one business script: `calc.js`
- Do not create tests, plans, design docs, or unrelated files
- Do not modify files outside `demo-workdir`

## Environment
- This repository uses ESM JavaScript
- Do not use `require`, `module.exports`, or `require.main`

## Behavior
- Read previous verification or human feedback first when it exists
- If there is no verification report yet, submit the first revision without comments
- If verification asks for comments, add comments directly in `calc.js`
- Keep the behavior simple: read two CLI args, convert to numbers, print their sum
