---
title: "Configuring Timezone Settings in FlowMetric"
category: config_fixes
---

FlowMetric stores all timestamps in UTC and converts them to display times based on your personal timezone setting. If you're seeing event times that look off, or if a scheduled report seems to cover the wrong hours, the fix is almost always updating your timezone in your profile. Go to your avatar in the top right corner, click Profile, and select your timezone from the dropdown. The change takes effect immediately with no page reload needed.

Timezone is a per-user setting, so everyone on your team can be in a different timezone and still see their own local times correctly — a teammate in Bengaluru and one in London will both see accurate local timestamps for the same event.

Workspace-level timezone is a separate setting and controls when automated jobs run. A workspace configured for India Standard Time will send its daily report at eight in the morning IST, not UTC. You'll find the workspace timezone in Settings under General.

If your team spans multiple time zones and you want scheduled reports to land at the same local time for everyone, the cleanest approach is creating a separate scheduled delivery for each region rather than trying to find a single time that works across all zones.
