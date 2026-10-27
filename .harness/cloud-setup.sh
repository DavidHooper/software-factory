#!/bin/bash
# Setup script for the Claude cloud environments that agent routines run in.
# Paste it into each environment's "Setup script" field (see
# docs/agents/cloud-routines.md). It runs as root before Claude Code starts,
# and the result is cached for about a week.
#
# The image ships Node 22, but the harness hooks run TypeScript directly and
# need the Node the harness pins in .harness/.node-version. A project that
# pins moon in its .prototools adds MOON_VERSION and the moon lines below
# (see src/cloud-setup.test.ts, which keeps the versions in sync with their
# pins).
set -euo pipefail

NODE_VERSION=26.10.0

curl -fsSL https://moonrepo.dev/install/proto.sh | bash -s -- --yes --no-profile
export PATH="$HOME/.proto/bin:$PATH"
proto install node "$NODE_VERSION"

# Put the pinned tools ahead of the image's Node 22 where /usr/local/bin comes
# first. Claude Code doesn't read /etc/profile.d, so the cloud-install hook also
# puts proto's shims first for its Bash commands.
node_bin=$(dirname "$(proto bin node "$NODE_VERSION")")
for tool in node npm npx; do
  ln -sf "$node_bin/$tool" "/usr/local/bin/$tool"
done
echo 'export PATH="/usr/local/bin:$PATH"' >/etc/profile.d/00-agent-toolchain.sh

node --version
