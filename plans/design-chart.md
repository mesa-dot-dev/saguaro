CURRENT DESIGN (adapter boundary for review + rules)
====================================================

REVIEW COMMAND PATH
-------------------
+--------------------------------------+
| User runs: mesa review ...           |
+-------------------+------------------+
                    |
                    v
+--------------------------------------+
| CLI entry                            |
| src/cli/bin/index.ts                 |
| - parse args, dispatch review        |
| - call reviewCommand(...)            |
| - process.exit(code)                 |
+-------------------+------------------+
                    |
                    v
+--------------------------------------+
| CLI review command                   |
| src/cli/review.ts                    |
| - gather git context/diffs           |
| - call runReview(...)                |
| - print output and return code       |
+-------------------+------------------+
                    |
                    v
+--------------------------------------+
| Review adapter                       |
| src/adapter/review.ts                |
| - runReview(request, runtime?)       |
| - use createNodeReviewRuntime()      |
|   when runtime is omitted            |
| - createReviewCore(...).review(...)  |
+-------------------+------------------+
                    |
                    v
+--------------------------------------+
| Runtime + Core + Runner              |
| src/lib/review-runtime.ts            |
| src/core/review.ts                   |
| src/lib/review-runner.ts             |
| - listChangedFiles(...)              |
| - loadRules(...)                     |
| - createReviewer(configPath?)        |
| - reviewer.review(input)             |
| - runReviewAgent(...)                |
+-------------------+------------------+
                    |
                    v
+--------------------------------------+
| Return path                           |
| core/review -> adapter/review         |
| -> cli/review -> cli/bin/index        |
| output + exit code                    |
+--------------------------------------+


RULES COMMAND PATH
------------------
+------------------------------+
| User runs: mesa rules ...    |
+--------------+---------------+
               |
               v
+------------------------------+
| CLI entry                    |
| src/cli/bin/index.ts         |
| - dispatch rules handlers    |
+--------------+---------------+
               |
               v
+------------------------------+
| CLI rules handlers           |
| src/cli/lib/rules.ts         |
| - prompts/formatting only    |
| - call adapter APIs          |
+--------------+---------------+
               |
               v
+------------------------------+
| Rules adapter API            |
| src/adapter/rules.ts         |
| - list/explain/validate      |
| - create/delete/locate       |
| - typed request/result       |
+--------------+---------------+
               |
               v
+------------------------------+
| Implementations              |
| src/lib/rules.ts             |
| - resolve dirs / parse yaml  |
| - schema validation          |
+------------------------------+


BOUNDARY SUMMARY
----------------
- review flow: cli -> adapter -> core -> lib
- rules flow:  cli -> adapter -> lib
- core imports no cli/adapter/lib
- process.exit only in src/cli/bin/index.ts


HIGH-LEVEL FLOW (EXACT)
-----------------------
1. packages/code-review/src/cli/bin/index.ts -> review command handler
2. packages/code-review/src/cli/review.ts -> reviewCommand(...)
3. packages/code-review/src/adapter/review.ts -> runReview(request, runtime?)
4. packages/code-review/src/lib/review-runtime.ts -> createNodeReviewRuntime() (if runtime omitted)
5. packages/code-review/src/core/review.ts -> createReviewCore(...).review(request)
6. packages/code-review/src/lib/review-runtime.ts -> listChangedFiles(...)
7. packages/code-review/src/lib/review-runtime.ts -> loadRules(...)
8. packages/code-review/src/lib/review-runtime.ts -> createReviewer(configPath?)
9. packages/code-review/src/lib/review-runtime.ts -> inline reviewer review(input)
10. packages/code-review/src/lib/review-runner.ts -> runReviewAgent(...)
11. return through core/review.ts -> adapter/review.ts -> cli/review.ts
12. CLI prints/output + exit code
