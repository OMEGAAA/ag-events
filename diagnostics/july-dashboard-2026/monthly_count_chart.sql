WITH monthly_counts (
  month_label,
  month_order,
  registered_records,
  date_ranges,
  active_records,
  archived_records,
  scheduled_facility_hours
) AS (
  VALUES
    ('3月', 3, 2, 2, 0, 2, 64.0),
    ('4月', 4, 97, 104, 0, 97, 1206.5),
    ('5月', 5, 1, 3, 1, 0, 15.8),
    ('6月', 6, 26, 41, 2, 24, 305.8),
    ('7月', 7, 4, 20, 3, 1, 262.0),
    ('8月', 8, 33, 111, 31, 2, 768.8)
)
SELECT
  month_label,
  month_order,
  '登録レコード' AS count_type,
  registered_records AS count,
  active_records,
  archived_records,
  scheduled_facility_hours
FROM monthly_counts
UNION ALL
SELECT
  month_label,
  month_order,
  '日程枠' AS count_type,
  date_ranges AS count,
  active_records,
  archived_records,
  scheduled_facility_hours
FROM monthly_counts
ORDER BY month_order, count_type;
