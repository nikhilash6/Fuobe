#!/usr/bin/env bash
# Packs a production build for a server that runs it from its own export of the same commit.
#
#   pnpm build && scripts/pack-build.sh <out.tar.zst>
#
# The archive holds two things:
# - fuobe-build.txt: the commit, the sha256 of its pnpm-lock.yaml, the Node, pnpm and Next versions, and the
#   packages the build loads from node_modules.
# - .next, without its cache, traces and generated types.
# No node_modules, no data, no env file: the server installs the commit's dependencies itself (native modules
# such as better-sqlite3 and sharp are built there) and keeps its own data and settings.
#
# The build reaches packages that stay outside the bundle through links: .next/node_modules/<package>-<hash>
# points into node_modules/.pnpm. The links are listed in fuobe-build.txt, not packed, so the archive holds only
# plain files and folders and the server makes each link again inside its own install.
set -euo pipefail

die() { echo "pack-build: $*" >&2; exit 1; }

out=${1:-}
[ -n "$out" ] || die "usage: scripts/pack-build.sh <out.tar.zst>"
[ -f package.json ] && [ -f pnpm-lock.yaml ] && [ -e .git ] || die "run it from the repository's root"
[ -s .next/BUILD_ID ] || die "no build here: run pnpm build first"
root=$(pwd -P)

# The build must be the commit: no changed tracked files, and the lockfile as committed.
commit=$(git rev-parse --verify HEAD)
[[ $commit =~ ^[0-9a-f]{40}$ ]] || die "HEAD is not a commit"
git diff --quiet HEAD -- || die "tracked files differ from $commit: pack a clean checkout"
lock=$(git cat-file blob "$commit:pnpm-lock.yaml" | sha256sum | cut -d' ' -f1)
next=$(node -p 'require("next/package.json").version')

# Links into node_modules: .next/node_modules/<name>-<hash>, or @scope/<name>-<hash>.
links=""
if [ -d .next/node_modules ]; then
  while IFS= read -r -d '' entry; do
    name=${entry#.next/node_modules/}
    if [ -d "$entry" ] && [ ! -L "$entry" ]; then
      [[ $name =~ ^@[A-Za-z0-9._-]+$ ]] || die "unexpected folder $entry"
      continue
    fi
    [ -L "$entry" ] || die "$entry is not a link"
    [[ $name =~ ^(@[A-Za-z0-9._-]+/)?[A-Za-z0-9._-]+-[0-9a-f]{8,64}$ ]] || die "unexpected link name $entry"
    target=$(realpath "$entry")
    case $target in
      "$root"/node_modules/.pnpm/*) target=${target#"$root"/} ;;
      *) die "$entry points outside node_modules/.pnpm" ;;
    esac
    [[ $target =~ ^node_modules/\.pnpm/[^/]+/node_modules/(@[^/]+/)?[^/]+$ ]] || die "unexpected target for $entry"
    links+="link $name $target"$'\n'
  done < <(find .next/node_modules -mindepth 1 -maxdepth 2 -print0 | LC_ALL=C sort -z)
fi

# What goes in: .next minus what only the build machine or an editor uses.
skip=(-path .next/cache -o -path .next/node_modules -o -path .next/types -o -path .next/dev
      -o -path .next/trace -o -path .next/trace-build)
odd=$(find .next \( "${skip[@]}" \) -prune -o ! -type f ! -type d -print | head -5)
[ -z "$odd" ] || die "not a plain file or folder: $odd"
private=$(find .next \( "${skip[@]}" \) -prune -o \( -name '.env*' -o -name '*.pem' -o -name '*.key' \
  -o -name '*.db' -o -name '*.db-*' -o -name '*.sqlite*' -o -name 'id_*' \) -print | head -5)
[ -z "$private" ] || die "refusing to pack what looks private: $private"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
find .next -mindepth 1 \( "${skip[@]}" \) -prune -o -print0 | LC_ALL=C sort -z > "$work/files"
{
  echo "fuobe-build 1"
  echo "commit $commit"
  echo "lockfile-sha256 $lock"
  echo "node $(node -v)"
  echo "pnpm $(pnpm -v)"
  echo "next $next"
  printf '%s' "$links"
} > "$work/fuobe-build.txt"

# Same commit, same bytes: fixed owner, modes and dates, and sorted names. zstd -19 makes it about a third of
# gzip's size (the server source maps are most of it).
mkdir -p "$(dirname "$out")"
tar --create --format=gnu --owner=0 --group=0 --numeric-owner --mode='u+rwX,go+rX,go-w' \
  --mtime="$(git log -1 --format=%cI "$commit")" --no-recursion \
  -C "$work" fuobe-build.txt -C "$root" --null -T "$work/files" | zstd -19 -T0 -q -c > "$out"

bytes=$(wc -c < "$out")
max=$((200 * 1024 * 1024))
[ "$bytes" -le "$max" ] || die "the archive is $((bytes / 1048576)) MB, over the server's limit"
echo "Packed ${commit:0:7}: $(tr -cd '\0' < "$work/files" | wc -c) entries, $((bytes / 1048576)) MB ($bytes bytes)."
echo "sha256 $(sha256sum "$out" | cut -d' ' -f1)"
