## What this PR does

<!-- One or two sentences. What changes for the user? -->

## Why

<!-- Link to the issue this closes, or describe the motivation. -->

## How to test

<!-- Steps a reviewer can follow to verify the change. If it's a UI change, attach screenshots or a recording. -->

## Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] If I touched a regulator ingester, every new `regulatory_fact` row has a `source_url` + `snapshot_date`
- [ ] If I added a translation, a native speaker has reviewed it (per `CONTRIBUTING.md`)
- [ ] No new secrets, internal URLs, or personal identifiers in the diff
