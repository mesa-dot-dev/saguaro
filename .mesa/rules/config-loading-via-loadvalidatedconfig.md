<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: config-loading-via-loadvalidatedconfig
title: Config must be loaded through loadValidatedConfig, not raw YAML parsing
severity: error
globs:
  - src/**/*.ts
  - "!src/config/**/*.ts"
  - "!src/**/__tests__/**"
tags:
  - config
  - validation
  - architecture
---

All code outside `src/config/` that needs to read the Mesa config must use `loadValidatedConfig()` from `src/config/model-config.ts`. Direct YAML parsing of `.mesa/config.yaml` bypasses Zod validation, default value injection, and the config resolution chain (MESA_CONFIG env var, default path fallback).

Flag:
- `yaml.load(...)` or `fs.readFileSync(...config.yaml...)` in files outside `src/config/`
- Direct `JSON.parse` or `yaml.load` of config file contents

The one exception is `src/config/catalog.ts` which reads/writes the config file directly for the `setModel` operation, which is a write path, not a read-for-use path.

### Violations

```
const raw = yaml.load(fs.readFileSync('.mesa/config.yaml', 'utf8'));
```

```
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
```

### Compliant

```
const config = loadValidatedConfig(configPath);
```

```
const { modelConfig, maxSteps } = loadReviewAdapterConfig();
```
