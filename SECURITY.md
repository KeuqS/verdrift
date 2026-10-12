# Security policy

verdrift reads files in the directory you point it at and, with `--local`, runs
`node --version`, `python3 --version` / `python --version`, and `go version`. Inside a git
work tree it also runs `git ls-files`. It makes no network requests and executes nothing
from the scanned repository.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the **Security** tab of this
repository and choose **Report a vulnerability**. Do not open a public issue.

You can expect an acknowledgement within a week. Fixes are released as a new patch version
and noted in [CHANGELOG.md](CHANGELOG.md).

## Supported versions

Only the latest release receives fixes.
