#!/usr/bin/env bash
# Launch the Next.js dev server with the correct Node version.
# The default shell here resolves to Node 16, which cannot run Next 16, so we
# prepend the Node 22 bin dir for the whole process tree.
export PATH="/Users/ovidiucotorogea/.nvm/versions/node/v22.13.1/bin:$PATH"
cd /Users/ovidiucotorogea/WebstormProjects/accomodation-comparison || exit 1
exec npm run dev -- --port 3100
