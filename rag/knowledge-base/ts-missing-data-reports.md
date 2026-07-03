---
title: "Troubleshooting Missing Data in Reports"
category: troubleshooting
---

Missing data in FlowMetric reports is almost always a filter or permissions issue rather than data actually being lost. Start by checking your active date range filter — if it's set to the last thirty days you simply won't see anything older. The date range picker is at the top right of every report view.

The second thing to check is the project selector in the top bar. Reports only include projects that are currently selected, so if you've accidentally deselected one, its data disappears from the view without any warning.

Role permissions matter too. Viewer accounts can't see time-tracking data or budget details by default. If you think you're missing a category of data rather than specific rows, ask your workspace admin to review your permissions.

If data is missing from a specific integration like Jira or GitHub, check that integration's sync status in Settings. A stalled sync pauses new data from coming in but doesn't delete historical records. If you genuinely suspect data loss, contact support immediately so we can check the audit log before any retention windows close.
