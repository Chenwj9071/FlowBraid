# demo-workdir local constraints

## Task boundary
- The only business deliverable is `calc.js`
- Do not create test files, design docs, planning docs, or unrelated helper files
- Stay inside this directory when working on the demo

## Runtime
- This repository uses `"type": "module"`
- `calc.js` must be valid ESM JavaScript
- Do not use `require`, `module.exports`, or `require.main`

## Deliverable contract
- `node calc.js 1 2` prints `3`
- `node calc.js 10 -4` prints `6`
- `node calc.js 1.5 2.5` prints `4`
- Print only the numeric result
- The first submission should be a minimal implementation without comments
- If verification asks for comments, add clear comments directly in `calc.js`
