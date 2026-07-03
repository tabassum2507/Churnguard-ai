---
title: "Troubleshooting Webhooks That Aren't Firing"
category: troubleshooting
---

When a FlowMetric webhook stops delivering, the first place to look is the Webhook Logs section in Settings under Developer. Every delivery attempt is recorded there with a timestamp, the HTTP status code your endpoint returned, and the full payload that was sent.

A 200 response in the logs means FlowMetric delivered successfully and the issue is somewhere downstream in your system. A 4xx error usually means your endpoint URL has changed or the endpoint is rejecting the Authorization header — check that your receiving server still expects the same token FlowMetric is sending. A 5xx error means your server returned an error, which is something to debug on your end.

FlowMetric retries failed deliveries up to three times with exponential backoff, so occasional failures during a deployment window will often self-resolve within a few minutes.

If the logs show no delivery attempts at all, the trigger event probably isn't occurring. Double-check the event types your webhook is subscribed to — for example, a webhook subscribed to milestone-completed won't fire for task-completed events. Webhooks are available on Pro and Enterprise plans only.
