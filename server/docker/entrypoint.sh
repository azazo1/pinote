#!/bin/sh
set -eu

data_dir="${PINOTE_DATA_DIR:-/data}"
generated_secret_dir="/secrets"

install --directory --owner pinote --group pinote "${data_dir}" "${generated_secret_dir}"
chown --recursive pinote:pinote "${data_dir}" "${generated_secret_dir}"

exec gosu pinote pinote-sync-server "$@"
