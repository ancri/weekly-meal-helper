#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${MEAL_HELPER_HOST:-}" ]]; then
  echo "MEAL_HELPER_HOST is required (the instance IP or hostname)." >&2
  exit 2
fi

ssh_key="${MEAL_HELPER_SSH_KEY:-${HOME}/.ssh/ancri}"
remote_target="ec2-user@${MEAL_HELPER_HOST}"
remote_backup="/tmp/meal-helper-production-backup.sqlite3"
local_backup="${1:-data/meal_helper.production.sqlite3}"
ssh_options=(-i "${ssh_key}" -o IdentitiesOnly=yes)

mkdir -p "$(dirname "${local_backup}")"

ssh "${ssh_options[@]}" "${remote_target}" \
  "sudo -u meal-helper python3 -c \"import sqlite3; source = sqlite3.connect('/opt/meal-helper/data/meal_helper.sqlite3'); destination = sqlite3.connect('${remote_backup}'); source.backup(destination); destination.close(); source.close()\""

scp "${ssh_options[@]}" "${remote_target}:${remote_backup}" "${local_backup}"
ssh "${ssh_options[@]}" "${remote_target}" "sudo rm -f '${remote_backup}'"

echo "Production database copied to ${local_backup}"
