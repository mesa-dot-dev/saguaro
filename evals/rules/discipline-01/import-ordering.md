<!-- This file is managed by Saguaro. Edit only if you know what you're doing. -->
---
id: import-ordering
title: Import statements must be grouped by origin
severity: warning
globs:
  - "**/*.ts"
  - "**/*.tsx"
---

External package imports must appear before relative imports.


### Violations

```
// Relative import appears before external package import
import { helper } from './utils';
import express from 'express';

```
