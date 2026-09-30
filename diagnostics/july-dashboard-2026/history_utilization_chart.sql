WITH july_history (
    snapshot_order,
    snapshot_label,
    commit_sha,
    registered_events,
    schedule_days,
    occupied_facility_hours,
    displayed_rate_pct
) AS (
    VALUES
        (1, '7/29 08:32', '8981db9', 29, 111, 646.5, 15),
        (2, '7/29 12:38', 'c50c11c', 13, 84, 573.0, 13),
        (3, '7/29 14:16', '66765a3', 14, 85, 587.8, 13),
        (4, '8/1 10:44', '3d6b196', 5, 22, 264.0, 6),
        (5, '8/7 11:18', '6084947', 4, 20, 262.0, 6),
        (6, '現在', '00ee445+45f1854', 4, 20, 262.0, 6)
)
SELECT
    snapshot_label,
    commit_sha AS commit,
    registered_events,
    schedule_days,
    occupied_facility_hours,
    displayed_rate_pct
FROM july_history
ORDER BY snapshot_order;
