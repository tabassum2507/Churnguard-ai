---
title: "Troubleshooting a Slow Dashboard"
category: troubleshooting
---

If your FlowMetric dashboard is loading slowly, there are a few things worth checking in order. The most common cause is a saved view that combines a long date range with many active filters — pulling eighteen months of data across every project is genuinely expensive. Try narrowing your date range to ninety days and see if that helps.

The second thing to check is how many widgets are on your dashboard. Each widget runs its own data query, so a dashboard with twelve widgets will always load more slowly than one with four. You can archive widgets you don't use daily by clicking the three-dot menu on each one.

Browser extensions, especially ad blockers, occasionally interfere with FlowMetric's JavaScript. Try loading the dashboard in a private browsing window to rule that out. If you're on a corporate network, VPN routing can also add latency to every request.

If slowness persists after those steps, check status.flowmetric.io to see whether there's a known infrastructure issue on our end before reaching out to support.
