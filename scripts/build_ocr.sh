#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .runtime
swiftc src/chart_platform/tools/recognize_text.swift -o .runtime/recognize_text
