#!/bin/sh
# Model-check every spec in this folder with TLC. TLA2TOOLS is the path to tla2tools.jar.
# CI runs it in the specs job. Each spec's .cfg sets the model size and the invariants.
set -e
cd "$(dirname "$0")"
for spec in *.tla; do
  java -cp "${TLA2TOOLS:?set TLA2TOOLS to the path of tla2tools.jar}" tlc2.TLC -workers auto -deadlock -cleanup "$spec"
done
