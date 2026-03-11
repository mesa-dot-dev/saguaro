#!/usr/bin/env node

const warnings = [];

try {
  require("better-sqlite3");
} catch {
  warnings.push(
    "better-sqlite3 failed to load. The background daemon requires it.",
    "  Fix: install build tools (apt install build-essential / xcode-select --install)",
    "  Then: npm rebuild better-sqlite3",
  );
}

if (warnings.length > 0) {
  console.warn("\n  Saguaro post-install warnings:\n");
  console.warn(warnings.join("\n"));
  console.warn(
    "\nSaguaro will still work for reviews — only the background daemon is affected.\n",
  );
}
