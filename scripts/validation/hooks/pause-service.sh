#!/bin/sh
# Staged-pair hook (feature 006): pauses one protocol service, so the app sees
# it as unreachable. android-flow.sh registers resume-service.sh in its cleanup
# before running this hook, so the service is always resumed.
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/compose-service.sh"
compose_service pause "${1:-}"
