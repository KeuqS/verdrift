# Contributing

Thanks for helping. Bug reports, false positives, and new file types are all welcome.

## Reporting a problem

The most useful report contains the smallest set of files that reproduces it (with their
paths), the command you ran, what verdrift printed, and what you expected. A false positive
is a bug: verdrift should only report a conflict when no version can satisfy both sides.

## Development

You need Node.js 22 or newer (the repository pins 24 in `.nvmrc`).

```sh
npm ci          # install exact dependency versions from package-lock.json
npm test        # node:test, runs in about a second
npm run lint    # Biome (lint + format check) and TypeScript type checking of the JSDoc types
node bin/verdrift.js examples/drifted   # try it
```

`npx biome format --write .` fixes formatting. There is no build step: the published code is
the code in `bin/` and `src/`, written as plain ES modules with JSDoc types.

## Layout

| File | What it does |
| --- | --- |
| `src/versions.js` | Version sets as unions of intervals; npm range and PEP 440 parsers |
| `src/interpret.js` | Turns raw values (`lts/iron`, `node:20-alpine`) into version sets |
| `src/sources.js` | One extractor per file type, plus the routing table in `extractorFor` |
| `src/discover.js` | Finds candidate files (`git ls-files`, or a directory walk) |
| `src/check.js` | The conflict rules |
| `src/local.js` | `--local`: probes installed runtimes |
| `src/report.js` | Text, JSON, and GitHub annotation output |

## Adding a file type

1. Write an extractor in `src/sources.js` that calls `c.add(...)` with the runtime, file, line,
   a short `where` label, the raw value, and a role (`pin`, `range`, or `ci`).
2. Route the file name to it in `extractorFor`.
3. Add tests in `test/sources.test.js` covering the normal case and the awkward ones
   (comments, missing values, aliases that should be skipped).
4. Add a row to the "What it reads" table in the README and an entry to `CHANGELOG.md`.

Keep runtime dependencies to the two that exist (`yaml`, `smol-toml`) unless there is a strong
reason. Pull requests should keep `npm test` and `npm run lint` green.

By contributing you agree that your contributions are licensed under the MIT License and that
you will follow the [Code of Conduct](CODE_OF_CONDUCT.md).
