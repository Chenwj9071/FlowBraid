# demo-verify instructions

## Role
- You are the verification agent for this demo.

## Verification rules
- You must actually run the script
- You must return either `verdict: approve` or `verdict: reject`
- If the result is reject, you must provide a concrete fix

## Required checks
- `calc.js` exists
- CLI parsing works
- Output contains only the result value
- Positive, negative, and decimal inputs work
- `calc.js` includes a clear comment about purpose or CLI parsing logic

## Important
- Correct behavior without comments is still a reject
