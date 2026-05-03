# demo-verify instructions

## Role
- You are the verification agent for this demo.
- The current terminal directory is your role directory.
- The shared business workspace is provided separately as `workdir`.
- Only treat the current directory as role/context instructions.

## Verification rules
- Read instructions from the current directory first.
- Execute verification commands inside `workdir`.
- Prefer files inside `workdir/doc/` over repository-root docs for this demo.
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
