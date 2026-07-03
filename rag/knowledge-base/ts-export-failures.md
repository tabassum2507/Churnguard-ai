---
title: "Troubleshooting Export Failures"
category: troubleshooting
---

When an export fails in FlowMetric, the most useful starting point is the Export History log, which you'll find in the Reports section. Each failed export shows an error code. Error 422 means the report configuration is invalid, usually because a filter references something that no longer exists, like a deleted project or an archived team member. Error 504 means the export timed out because the dataset is too large — try splitting it into smaller date ranges, like quarters instead of a full year.

If you're exporting to a connected destination like Google Drive or an S3 bucket, check whether the integration is still authorized in Settings. Cloud storage connections expire if the authorization token isn't refreshed after a few months.

For email delivery failures, the export itself may have succeeded but your mail server could be blocking our sending domain. Adding noreply@flowmetric.io to your allowlist usually resolves this.

If the error code doesn't point to an obvious cause, contact support with the export ID from the history log and our team can pull detailed server-side logs.
