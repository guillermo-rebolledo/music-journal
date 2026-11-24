#!/bin/sh
set -eu

export CATALOG_TEST_REMOTE_SNAPSHOT=0
CATALOG_SOURCE=remote sh scripts/test-browser.sh
for scenario in local-catalog-search catalog-identity local-discover catalog-outage; do
  CATALOG_SOURCE=local sh scripts/test-browser.sh "tests/$scenario.spec.ts"
done
CATALOG_SOURCE=remote CATALOG_TEST_REMOTE_SNAPSHOT=1   sh scripts/test-browser.sh tests/catalog-identity.spec.ts -g "remote rollback"
