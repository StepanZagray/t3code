# T3 Code

T3 Code is an "agent harness control surface". It enables control of the agents on your machine with a best-in-class mobile app ([iOS](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824), [Android](https://play.google.com/store/apps/details?id=com.t3tools.t3code)), [web app](https://app.t3.codes) and [Electron-based desktop app](https://t3.codes).

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, OpenCode, and Google Antigravity. If they're set up on your computer, T3 Code can control them.

> [!NOTE]
> **This is a personal fork** ([StepanZagray/t3code](https://github.com/StepanZagray/t3code)) of [pingdotgg/t3code](https://github.com/pingdotgg/t3code). It tracks upstream and is installed locally as a nightly Linux AppImage plus an Android preview build. See [Updating this fork](#updating-this-fork).

## "Wait, what are you selling me?"

Nothing. We built T3 Code because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar.

We wanted something performant, remote-ready, and truly open. If we ever go the wrong direction, we want you to have everything you need to fork and build the editor that you want.

## Installation

> [!WARNING]
> T3 Code currently supports Codex, Claude, Cursor, Grok Build, OpenCode, and Antigravity. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
> - Antigravity: enable it in Settings, then use **Install Antigravity** and **Sign in with Google**. No CLI is required.

### Command line

```bash
curl -fsSL https://t3.codes/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://t3.codes/install.ps1 | iex
```

Then run `t3` to start the server and open the local web app. `t3 service install` keeps it running in the background, `t3 update` moves to a newer release, and `t3 --help` has the full reference.

To try it once without installing, run `npx t3@latest`. It offers to install the `t3` command for you.

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### Windows (`scoop`)

```bash
scoop install extras/t3code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Debian, Ubuntu (`.deb`)

Download the `.deb` from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), then:

```bash
sudo apt install ./T3-Code-*.deb
```

#### Arch Linux (AUR)

Stable:

```bash
yay -S t3code-bin
```

Nightly:

```bash
yay -S t3code-nightly-bin
```

The AUR packaging is maintained in this repository under [`packaging/aur`](./packaging/aur).

## Updating this fork

Remotes: `origin` is the fork, `upstream` is `pingdotgg/t3code`.

### Desktop (Linux AppImage)

`~/.local/bin/t3code-update` rebases any fork commits on `main` onto `upstream/main`, builds a nightly AppImage, and installs it to `~/.local/opt/t3code-nightly/`. `~/.local/bin/t3code` launches it with `T3CODE_HOME=~/.t3-nightly`.

```bash
t3code-update            # fetch upstream, rebase, build, install
t3code-update --no-pull  # rebuild and install the current checkout
```

The script needs a clean working tree on `main`. It keeps the newest 3 AppImages, so you can roll back by re-pointing the `T3-Code-Nightly.AppImage` symlink. Restart T3 Code after updating.

<details>
<summary><code>~/.local/bin/t3code-update</code></summary>

```bash
#!/usr/bin/env bash
# Update the T3 Code checkout (rebasing any fork commits onto upstream), build a
# nightly AppImage, and install it where the t3code launcher looks for it.
#
#   t3code-update            pull upstream, build, install
#   t3code-update --no-pull  rebuild and install the current checkout
#
# Env: T3CODE_LOCAL_REPO (source checkout), T3CODE_LOCAL_KEEP (AppImages to keep, default 3)
set -euo pipefail

repo="${T3CODE_LOCAL_REPO:-$HOME/Projects/code/t3code}"
install_dir="$HOME/.local/opt/t3code-nightly"
keep="${T3CODE_LOCAL_KEEP:-3}"
pull=1

case "${1:-}" in
  "") ;;
  --no-pull) pull=0 ;;
  -h | --help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
esac

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

cd "$repo"
exec 9>"$(git rev-parse --git-dir)/t3code-update.lock"
flock -n 9 || die "another update is already running"

# Forks pull from an "upstream" remote; a plain clone pulls from origin.
remote=upstream
git remote get-url upstream >/dev/null 2>&1 || remote=origin

rebasing() { [[ -d "$(git rev-parse --git-path rebase-merge)" || -d "$(git rev-parse --git-path rebase-apply)" ]]; }

rebasing && die "a rebase is already in progress in $repo; finish or abort it first"
[[ "$(git branch --show-current)" == main ]] || die "checkout main first"
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || die "working tree has uncommitted changes; commit or stash them first"

if ((pull)); then
  log "Fetching upstream"
  git fetch --tags "$remote"

  log "Rebasing onto $remote/main"
  if ! git rebase "$remote/main"; then
    # pnpm-lock.yaml conflicts on almost every pull; never merge it by hand.
    # Take upstream's copy and let pnpm re-add the fork's dependencies.
    while rebasing; do
      conflicts="$(git diff --name-only --diff-filter=U)"
      if [[ "$conflicts" != pnpm-lock.yaml ]]; then
        git rebase --abort
        die "rebase conflicts need manual resolution (rebase aborted, nothing changed):
$conflicts
Run 'git rebase $remote/main' in $repo, resolve, then rerun with --no-pull."
      fi
      log "Regenerating conflicted pnpm-lock.yaml"
      git checkout --ours pnpm-lock.yaml
      vp i
      git add pnpm-lock.yaml
      GIT_EDITOR=true git rebase --continue || true
    done
  fi
fi

log "Installing dependencies"
vp i
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse "$remote/main")" ]]; then
  vp dedupe # duplicate @types/* versions break typechecking after a lockfile regen
  if [[ -n "$(git status --porcelain pnpm-lock.yaml)" ]]; then
    log "Folding lockfile update into the fork commit"
    git commit -q --amend --no-edit --no-verify pnpm-lock.yaml
  fi
elif [[ -n "$(git status --porcelain pnpm-lock.yaml)" ]]; then
  # A plain clone builds upstream's lockfile as-is; drop local resolver churn.
  log "Discarding local pnpm-lock.yaml changes"
  git checkout -- pnpm-lock.yaml
fi

# Version: newest upstream nightly base (e.g. 0.0.43) plus a local timestamp.
base="$({ git tag --merged HEAD --sort=-creatordate 'v*-nightly.*' || true; } | head -n1 | sed -E 's/^v([0-9.]+)-.*/\1/')"
[[ -n "$base" ]] || base="$(node -p "require('./apps/desktop/package.json').version")"
# One numeric identifier: semver drops leading zeros (".0858" becomes ".858").
version="$base-nightly.$(date +%Y%m%d%H%M)"

log "Building T3 Code $version"
T3CODE_DESKTOP_VERSION="$version" T3CODE_DESKTOP_OUTPUT_DIR=release-nightly vp run dist:desktop:linux

name="T3-Code-$version-x86_64.AppImage"
artifact="release-nightly/$name"
[[ -f "$artifact" ]] || die "build finished but $artifact is missing"

log "Installing to $install_dir"
mkdir -p "$install_dir"
# Copy under a temp name, then rename, so a running app is never handed a half-written file.
cp "$artifact" "$install_dir/.$name.tmp"
chmod 755 "$install_dir/.$name.tmp"
mv -f "$install_dir/.$name.tmp" "$install_dir/$name"
ln -sfn "$name" "$install_dir/.T3-Code-Nightly.AppImage.tmp"
mv -Tf "$install_dir/.T3-Code-Nightly.AppImage.tmp" "$install_dir/T3-Code-Nightly.AppImage"
rm -f "$artifact" "release-nightly/T3-Code-$version-amd64.deb"

# Keep the newest $keep AppImages so a bad build can be rolled back by re-pointing the symlink.
mapfile -t old < <(
  find "$install_dir" -maxdepth 1 -type f -name 'T3-Code-*.AppImage' -printf '%T@ %p\n' |
    sort -rn | cut -d' ' -f2- | tail -n +"$((keep + 1))"
)
if ((${#old[@]})); then
  log "Removing old builds: ${old[*]##*/}"
  rm -f -- "${old[@]}"
fi

log "Done: T3 Code $version installed. Restart T3 Code to use it."
ahead="$(git rev-list --count "$remote/main..HEAD")"
if ((ahead)); then
  echo "    Fork is $ahead commit(s) ahead of $remote. Push with: git push --force-with-lease origin main"
fi
```

</details>

<details>
<summary><code>~/.local/bin/t3code</code></summary>

```bash
#!/usr/bin/env bash
# Launch the locally-built, correctly versioned T3 Code nightly AppImage.
set -euo pipefail

appimage="${T3CODE_LOCAL_APPIMAGE:-$HOME/.local/opt/t3code-nightly/T3-Code-Nightly.AppImage}"

# Keep the existing nightly history instead of falling back to ~/.t3.
export T3CODE_HOME="${T3CODE_HOME:-$HOME/.t3-nightly}"

die() {
  echo "t3code: $1" >&2
  command -v notify-send >/dev/null 2>&1 && notify-send -u critical "T3 Code Nightly" "$1"
  exit 1
}

[[ -x $appimage ]] || die "nightly AppImage not found or not executable: $appimage"

exec "$appimage" "$@"
```

</details>

### Android (preview app)

With the phone connected over USB (`adb devices`), from `apps/mobile`:

```bash
APP_VARIANT=preview EXPO_NO_GIT_STATUS=1 npx expo prebuild --clean --platform android
APP_VARIANT=preview npx expo run:android --variant release --no-bundler --device <adb-serial>
```

This builds a standalone release APK of `com.t3tools.t3code.preview` and upgrades it in place. It is signed with the stock React Native debug key, so it upgrades earlier local builds without wiping app data. An APK signed with a different key has to be uninstalled first.

## Some notes

We are very very early in this project. Expect bugs.

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [FAQ](./docs/user/faq.md)
- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Project settings](./docs/user/project-settings.md)
- [Appearance preferences](./docs/user/appearance.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Connect Claude Code, Codex, ChatGPT and other agents over MCP](./docs/user/outside-agents.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- [Run T3 Code as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## If you REALLY want to contribute still.... read this first

### Install `vp`

T3 Code uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before reporting a bug or opening a PR.

Have a feature request? Start an [Ideas discussion](https://github.com/pingdotgg/t3code/discussions/categories/ideas).

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
