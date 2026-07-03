---
title: "Connecting Data Sources to FlowMetric"
category: onboarding
---

FlowMetric can pull data from the tools your team already uses, which means you don't have to duplicate work by entering things in two places. The most popular integrations are Jira, GitHub, Google Sheets, and HubSpot. To connect one, go to Settings, then Integrations, find the tool you want, and click Authorize. You'll be redirected to that tool to approve the connection, and once you return the first sync starts automatically.

The initial sync can take up to ten minutes depending on how much historical data the source has. After that, data refreshes every fifteen minutes. You can also connect integrations at the project level rather than the workspace level, which is useful when different projects use different tools.

If the tool you need isn't in the integration list, the FlowMetric API and the Zapier connector cover most other cases without custom development. Custom webhook sources, where an external system pushes data into FlowMetric directly, are available on Pro and Enterprise for more advanced setups. Integration status and last-sync timestamps are always visible in Settings so you can confirm data is flowing before your first report depends on it.
