---
title: "Optimizing Filters for Dashboard Performance"
category: config_fixes
---

If your FlowMetric dashboards are loading slowly, the filter configuration is usually the first thing to review. The biggest performance impact comes from combining a wide date range — anything over six months — with filters on multiple fields at the same time. A practical rule of thumb is to use date range as your primary filter and keep additional dimensions to two or three at most.

Saved filters compound over time. If you have a saved view that was built months ago with overlapping or redundant conditions, it's worth opening it up and simplifying it. Removing even one unnecessary filter can meaningfully improve load time.

Filters on indexed fields — project ID, user ID, and date — are fast because the database can look them up directly. Filters on free-text fields like task names or notes require a full scan and are much slower. If you need to search by keyword regularly, use the dedicated Search bar at the top of the page rather than adding a text filter to your dashboard.

Archiving completed projects also helps. Archived projects are excluded from default queries, which reduces the amount of data every dashboard widget has to scan.
