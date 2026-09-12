# yumml — every task that matters, in one place. Run `just` for the list.
#
# These recipes are the contract with CI: the workflows call the same names you
# do, so "it works here" and "it works in the pipeline" are the same sentence.

set shell := ["bash", "-euo", "pipefail", "-c"]

pnpm := "pnpm"
dev := "node --conditions=yumml-dev packages/cli/src/main.ts"
packages := "packages/core packages/cli"
tarballs := ".pack"

# List the recipes.
default:
    @just --list

# ----------------------------------------------------------------- setup ---

# Install the workspace exactly as the lockfile says.
install:
    {{pnpm}} install --frozen-lockfile

# ---------------------------------------------------------------- checks ---

# Biome: formatter and linter.
check:
    {{pnpm}} run check

# Apply biome's safe fixes.
check-fix:
    {{pnpm}} run check:write

# The TypeScript compiler, across all packages.
typecheck:
    {{pnpm}} run typecheck

# The test suite.
test:
    {{pnpm}} run test

# Regenerate the checked-in JSON Schema. Not part of `ci`: the suite already
# fails when the checked-in file and the generator disagree, and a CI run that
# rewrote the file could hide that drift instead of reporting it.
schema:
    {{pnpm}} run schema

# Compile every package into dist/.
build:
    {{pnpm}} run build

# The gate. Passes locally means it passes in CI, and vice versa.
ci: check typecheck build test
    @echo "ci: ok"

# ------------------------------------------------------------ cli helpers ---

# Check a recipe, with a code frame for every problem.
validate file:
    @{{dev}} validate {{file}}

# The same, as JSON, for a machine.
validate-json file:
    @{{dev}} validate {{file}} --json

# Print a recipe's model: ingredients, cooking order, ledger.
parse file:
    @{{dev}} parse {{file}} --summary

# The model itself, as JSON.
parse-json file:
    @{{dev}} parse {{file}} --json

# ------------------------------------------------------------- packaging ---

# Build, then pack both packages into .pack/ for inspection.
pack: build
    #!/usr/bin/env bash
    rm -rf {{tarballs}}
    mkdir -p {{tarballs}}
    {{pnpm}} --filter @yumml/core pack --pack-destination "$PWD/{{tarballs}}"
    {{pnpm}} --filter @yumml/cli pack --pack-destination "$PWD/{{tarballs}}"
    ls -1 {{tarballs}}

# Pack, then prove the tarball works. The one-shot version of the check.
smoke: pack smoke-tarballs

# Install the packed tarballs in a scratch dir and run the binary there.
smoke-tarballs:
    #!/usr/bin/env bash
    # Catches a bad `files` list, a missing bin, or a workspace:* dependency that
    # never got rewritten. CI runs it before publishing.
    #
    # Kept separate from `pack` so a job can build on one Node and run the
    # artifact on another: pnpm 11 needs Node >=22.13, and the engines floor is
    # older than that.
    set -euo pipefail
    here="$PWD"
    if ! compgen -G "$here/{{tarballs}}/*.tgz" >/dev/null; then
      echo "no tarballs in {{tarballs}}/; run 'just pack' first" >&2
      exit 1
    fi
    dir="$(mktemp -d)"
    trap 'rm -rf "$dir"' EXIT
    cd "$dir"
    npm init -y >/dev/null
    npm install --silent "$here"/{{tarballs}}/*.tgz
    ./node_modules/.bin/yumml --version
    ./node_modules/.bin/yumml validate "$here"/fixtures/banana.valid.yaml
    echo "smoke: the packed CLI works"

# Show what `publish` would upload, without uploading it.
publish-dry: build
    {{pnpm}} -r publish --dry-run --no-git-checks

# --------------------------------------------------------------- version ---

# The version both packages declare. They move in lockstep.
version:
    @{{pnpm}} pkg get version --dir packages/core

# Fail unless <tag> (v0.1.0) matches the versions in both packages.
verify-version tag:
    #!/usr/bin/env bash
    # CI runs this on the tag; `release` relies on it being true.
    want="{{tag}}"
    want="${want#v}"
    for pkg in {{packages}}; do
      got="$({{pnpm}} pkg get version --dir "$pkg")"
      if [[ "$got" != "$want" ]]; then
        echo "tag v$want does not match $pkg, which says $got" >&2
        exit 1
      fi
    done
    echo "tag v$want matches both packages"

# Move both packages to <version>. Does not commit.
# The lockfile does not record a package's own version, so only the two
# package.json files change.
bump version:
    {{pnpm}} pkg set version={{version}} --dir packages/core
    {{pnpm}} pkg set version={{version}} --dir packages/cli
    @echo "both packages are now $({{pnpm}} pkg get version --dir packages/core)"

# Refuse to release from a state that cannot be released.
_preflight version:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ ! "{{version}}" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
      echo "not a version: {{version}} (expected MAJOR.MINOR.PATCH[-prerelease])" >&2
      exit 1
    fi
    if [[ -n "$(git status --porcelain)" ]]; then
      echo "the working tree is dirty; commit or stash first" >&2
      exit 1
    fi
    branch="$(git rev-parse --abbrev-ref HEAD)"
    if [[ "$branch" != "main" ]]; then
      echo "on $branch; releases are cut from main" >&2
      exit 1
    fi
    if git rev-parse -q --verify "refs/tags/v{{version}}" >/dev/null; then
      echo "tag v{{version}} already exists" >&2
      exit 1
    fi
    current="$({{pnpm}} pkg get version --dir packages/core)"
    if [[ "$current" == "{{version}}" ]]; then
      echo "the packages are already at {{version}}" >&2
      exit 1
    fi
    echo "preflight: clean tree on main, v{{version}} is free (currently $current)"

# Show the release without doing it.
release-dry version: (_preflight version)
    @echo "would run: bump {{version}} -> git commit -> git tag v{{version}} -> git push"
    @echo "CI would then verify the tag, smoke the tarballs, publish to npm,"
    @echo "and open a GitHub Release for v{{version}}"

# Cut a release: gate, bump, commit, tag, push. GitHub Actions does the rest.
release version: (_preflight version)
    #!/usr/bin/env bash
    set -euo pipefail
    # Gate first. Bumping before the tests run would leave a failed release
    # sitting in the working tree as an uncommitted version change.
    just ci
    just bump "{{version}}"
    git add --all
    git commit -m "chore(release): v{{version}}"
    git tag -a "v{{version}}" -m "yumml v{{version}}"
    git push origin HEAD "v{{version}}"
    echo
    echo "pushed v{{version}}. Watch the release workflow, then:"
    echo "  just verify-release {{version}}"

# Confirm the registry really serves what you just tagged.
verify-release version:
    #!/usr/bin/env bash
    set -euo pipefail
    for pkg in @yumml/core @yumml/cli; do
      for i in 1 2 3 4 5 6 7 8 9 10; do
        if npm view "$pkg@{{version}}" version >/dev/null 2>&1; then
          echo "$pkg@{{version}} is on the registry"
          break
        fi
        if [[ "$i" == 10 ]]; then
          echo "$pkg@{{version}} is not on the registry yet" >&2
          exit 1
        fi
        sleep 6
      done
    done

# ---------------------------------------------------------------- house ----

# Remove build output and packed tarballs.
clean:
    rm -rf {{tarballs}} packages/core/dist packages/cli/dist
    @echo "clean"
