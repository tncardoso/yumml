# Releasing yumml

How a version gets from a commit to npm, and what a maintainer has to do by hand.
The machine does the rest: [`release.yml`](../../.github/workflows/release.yml) runs
when a `v*` tag is pushed.

The short version:

```console
$ $EDITOR CHANGELOG.md     # section 1
$ just release 0.2.0       # section 2
$ just verify-release 0.2.0
```

## 1. The changelog

`CHANGELOG.md` follows [Keep a Changelog][kac], and the packages follow
[Semantic Versioning][semver]. Both are conventions you have to keep by hand:
nothing checks this file, and `just release` will not write it.

Write entries under `## [Unreleased]` as you work, in the sections Keep a
Changelog names — `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`,
`Security`. Write them for someone deciding whether to upgrade their lockfile,
not for someone reading the commit log.

At release time, three edits:

1. Rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`.
2. Add a fresh, empty `## [Unreleased]` above it.
3. Repair the link at the bottom of the file. It tracks the newest release, so it
   becomes a compare against the tag you are about to push:

   ```markdown
   [Unreleased]: https://github.com/tncardoso/yumml/compare/v0.2.0...HEAD
   [0.2.0]: https://github.com/tncardoso/yumml/compare/v0.1.0...v0.2.0
   ```

The reason `just release` leaves this to you is that only a person knows whether
a change is worth telling users about. The GitHub Release is not a substitute:
its notes come from `--generate-notes`, which is derived from commits.

Nothing enforces the edit. A release that leaves `[Unreleased]` in place is
visibly missing its entry, which is the only reminder there is.

## 2. Cutting the release

```console
$ just release-dry 0.2.0
preflight: clean tree on main, v0.2.0 is free (currently 0.1.0)
would run: bump 0.2.0 -> git commit -> git tag v0.2.0 -> git push

$ just release 0.2.0
```

`just release` refuses to start unless all of these hold:

- the version argument is `MAJOR.MINOR.PATCH[-prerelease]`;
- the working tree is clean, **including untracked files**;
- the current branch is `main`;
- the tag `vX.Y.Z` does not already exist;
- the packages are not already at `X.Y.Z`.

It then gates with `just ci` **before** it bumps, so a failing test leaves your
tree exactly as it found it. After that it bumps both packages to the same
version, commits `chore(release): vX.Y.Z`, tags `vX.Y.Z`, and pushes the commit
and the tag.

From there GitHub Actions takes over: `verify` re-runs the suite against the tag
and checks that the tag matches the manifests, `publish` sends both packages to
npm with provenance, and a GitHub Release is opened last, so it is never a
promise the registry has not kept.

Confirm from your own machine when it finishes:

```console
$ just verify-release 0.2.0
@yumml/core@0.2.0 is on the registry
@yumml/cli@0.2.0 is on the registry
```

## 3. Pre-releases

```console
$ just release 0.2.0-rc.1
```

The same path with a different ending: npm gets the `next` dist-tag instead of
`latest`, and the GitHub Release is marked a pre-release. Testers install with
`npm install @yumml/core@next`. Promoting it is `just release 0.2.0`.

## 4. A bad release

A published version cannot be replaced on npm, and the tag is not rewritten.

1. `npm deprecate @yumml/core@0.2.0 "use 0.2.1"` — tells installers to move.
2. Fix on `main`, with a changelog entry.
3. `just release 0.2.1`.

If `verify` fails on the tag, nothing was published, so recovery is free: delete
the tag (`git push --delete origin v0.2.0`), fix, and tag again.

## Where the rest is

This file is the do-this. The decisions behind it — why publishing goes through
pnpm, why the workflow is pinned to commit SHAs, what has to be configured on
npm before the first release — are in [`plan-ci.md`](../../plan-ci.md).

[kac]: https://keepachangelog.com/en/1.1.0/
[semver]: https://semver.org/spec/v2.0.0.html
