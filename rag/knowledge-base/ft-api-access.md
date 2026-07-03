---
title: "Using the FlowMetric API"
category: feature_tips
---

FlowMetric's API lets you pull your project data into any external system — dashboards, data warehouses, or custom scripts. To get started, go to Settings, then Developer, and generate an API key. Your key gives you read access by default, so you can query projects, milestones, time entries, and team activity. Write access can be enabled from the same panel if your use case requires it.

The base URL is api.flowmetric.io, and every request needs your key in the Authorization header as a Bearer token. Rate limits are generous — up to one thousand requests per hour on Pro and five thousand on Enterprise. The API follows REST conventions, so most developers find it familiar right away.

FlowMetric also publishes a Postman collection in the developer docs that covers the most common endpoints with ready-to-run examples. If you're building a recurring sync, we recommend caching responses for at least five minutes to avoid hitting limits during high-frequency polling.
