#!/bin/sh
# Staged-pair hook (feature 006): resumes a service pause-service.sh paused.
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/compose-service.sh"
compose_service unpause "${1:-}"
