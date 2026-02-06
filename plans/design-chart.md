# Code Review System Flow Chart

```text
+----------------------------+
| User runs: mesa review     |
+-------------+--------------+
              |
              v
+----------------------------+
| Parse CLI args             |
+-------------+--------------+
              |
              v
+----------------------------+
| Load .mesa/config.yaml     |
+-------------+--------------+
              |
              v
+----------------------------+
| Get changed files          |
| git diff <base>...HEAD     |
+-------------+--------------+
              |
              v
+----------------------------+
| Load rules from            |
| .mesa/rules/*.yaml         |
+-------------+--------------+
              |
              v
+----------------------------+
| Select applicable rules    |
| per file                   |
+-------------+--------------+
              |
              v
+----------------------------+
| Split files into workers   |
| review.files_per_worker    |
+-------------+--------------+
              |
              v
+----------------------------+
| Start/Open OpenCode        |
| runtime                    |
+-------------+--------------+
              |
              v
+----------------------------+
| Create n sessions          |
| per worker                 |
+-------------+--------------+
              |
              v
+----------------------------+
| Send prompt to each        |
| worker session             |
+-------------+--------------+
              |
              v
+----------------------------+
| Agent calls view_diff      |
| for each file              |
+-------------+--------------+
              |
              v
+----------------------------+
| Agent returns violation    |
| lines                      |
+-------------+--------------+
              |
              v
+----------------------------+
| Runner streams events      |
| tool/status/permission     |
+-------------+--------------+
              |
              v
+----------------------------+
| On idle, fetch final       |
| assistant messages         |
+-------------+--------------+
              |
              v
+----------------------------+
| Parse violation lines      |
| with regex matcher +       |
| parse diagnostics          |
+-------------+--------------+
              |
              v
+----------------------------+
| Aggregate findings         |
| and summary                |
+-------------+--------------+
              |
              v
+----------------------------+
| Render output              |
+-------------+--------------+
              |
              v
+----------------------------+
| Cleanup sessions/runtime   |
+----------------------------+
```
