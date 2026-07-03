---
title: "Scheduling Data Exports in FlowMetric"
category: feature_tips
---

If you need FlowMetric data in another tool on a regular basis, scheduled exports are the cleanest way to handle it. You set up the export once — choose your report, pick your format, which can be CSV, Excel, or JSON — add the recipient email addresses, and set your schedule. FlowMetric supports daily, weekly, and monthly cadences, and you can specify the exact time of day the export should run.

Exports always reflect a complete snapshot at the moment they run, so a daily export at eight in the morning gives you the previous day's complete data. For larger datasets the export runs in the background and delivers a download link by email when it's ready, which usually takes less than two minutes.

Scheduled exports are available on Pro and Enterprise plans. Free and Starter users can always run manual exports from the Reports section whenever they need them. JSON format is the best choice if you're piping data into a data warehouse or a business intelligence tool, as it preserves data types without the formatting quirks of CSV.
