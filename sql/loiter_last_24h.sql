-- Loitering Detection Query
-- Detects vessels that have been stationary or moving slowly in a small area for extended periods
-- Used for identifying vessels that may be conducting surveillance or waiting for something

WITH vessel_movement AS (
  SELECT 
    vp.mmsi,
    v.name,
    v.vessel_type,
    v.is_military,
    v.is_research,
    v.flag,
    vp.coordinates,
    vp.timestamp,
    vp.speed,
    vp.course,
    vp.partition_date,
    
    -- Calculate movement between consecutive positions
    LAG(vp.coordinates) OVER (PARTITION BY vp.mmsi ORDER BY vp.timestamp) as prev_coordinates,
    LAG(vp.timestamp) OVER (PARTITION BY vp.mmsi ORDER BY vp.timestamp) as prev_timestamp,
    LAG(vp.speed) OVER (PARTITION BY vp.mmsi ORDER BY vp.timestamp) as prev_speed
    
  FROM `svalmap.marine_osint.vessel_positions` vp
  JOIN `svalmap.marine_osint.vessels` v ON vp.mmsi = v.mmsi
  WHERE vp.timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
    AND vp.partition_date = CURRENT_DATE()
),

movement_analysis AS (
  SELECT 
    mmsi,
    name,
    vessel_type,
    is_military,
    is_research,
    flag,
    coordinates,
    timestamp,
    speed,
    course,
    
    -- Calculate distance moved
    CASE 
      WHEN prev_coordinates IS NOT NULL THEN ST_DISTANCE(coordinates, prev_coordinates)
      ELSE 0
    END as distance_moved_meters,
    
    -- Calculate time between positions
    CASE 
      WHEN prev_timestamp IS NOT NULL THEN TIMESTAMP_DIFF(timestamp, prev_timestamp, MINUTE)
      ELSE 0
    END as time_diff_minutes,
    
    -- Calculate effective speed (distance/time)
    CASE 
      WHEN prev_timestamp IS NOT NULL AND prev_coordinates IS NOT NULL THEN
        ST_DISTANCE(coordinates, prev_coordinates) / (TIMESTAMP_DIFF(timestamp, prev_timestamp, SECOND) / 3600.0)
      ELSE 0
    END as effective_speed_knots
    
  FROM vessel_movement
),

loitering_detection AS (
  SELECT 
    mmsi,
    name,
    vessel_type,
    is_military,
    is_research,
    flag,
    coordinates,
    timestamp,
    speed,
    course,
    distance_moved_meters,
    time_diff_minutes,
    effective_speed_knots,
    
    -- Determine loitering behavior
    CASE 
      WHEN effective_speed_knots < 1 AND time_diff_minutes >= 120 THEN 'stationary'
      WHEN effective_speed_knots < 3 AND time_diff_minutes >= 60 THEN 'slow_moving'
      WHEN effective_speed_knots < 5 AND time_diff_minutes >= 30 THEN 'minimal_movement'
      ELSE 'normal'
    END as movement_pattern,
    
    -- Calculate loitering duration
    SUM(time_diff_minutes) OVER (
      PARTITION BY mmsi 
      ORDER BY timestamp 
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) as cumulative_time_minutes
    
  FROM movement_analysis
  WHERE effective_speed_knots < 5 -- Focus on slow-moving vessels
),

loitering_summary AS (
  SELECT 
    mmsi,
    name,
    vessel_type,
    is_military,
    is_research,
    flag,
    
    -- Get the most recent position
    ARRAY_AGG(coordinates ORDER BY timestamp DESC LIMIT 1)[OFFSET(0)] as current_coordinates,
    
    -- Get the earliest position in loitering period
    ARRAY_AGG(coordinates ORDER BY timestamp ASC LIMIT 1)[OFFSET(0)] as start_coordinates,
    
    -- Calculate loitering area (bounding box)
    ST_BOUNDINGBOX(ST_UNION_AGG(coordinates)) as loitering_area,
    
    -- Calculate center point of loitering area
    ST_CENTROID(ST_UNION_AGG(coordinates)) as loitering_center,
    
    -- Calculate total distance moved
    SUM(distance_moved_meters) as total_distance_moved_meters,
    
    -- Calculate average speed
    AVG(effective_speed_knots) as avg_effective_speed_knots,
    
    -- Calculate loitering duration
    MAX(cumulative_time_minutes) as total_loitering_minutes,
    
    -- Count position updates
    COUNT(*) as position_updates,
    
    -- Determine loitering severity
    CASE 
      WHEN MAX(cumulative_time_minutes) >= 480 THEN 'extended' -- 8+ hours
      WHEN MAX(cumulative_time_minutes) >= 240 THEN 'prolonged' -- 4+ hours
      WHEN MAX(cumulative_time_minutes) >= 120 THEN 'moderate' -- 2+ hours
      ELSE 'brief'
    END as loitering_severity,
    
    -- Risk assessment
    CASE 
      WHEN is_military = TRUE THEN 'high'
      WHEN is_research = TRUE THEN 'medium'
      WHEN vessel_type IN ('fishing', 'cargo') THEN 'medium'
      ELSE 'low'
    END as risk_level
    
  FROM loitering_detection
  WHERE movement_pattern IN ('stationary', 'slow_moving', 'minimal_movement')
    AND cumulative_time_minutes >= 60 -- At least 1 hour of loitering
  GROUP BY mmsi, name, vessel_type, is_military, is_research, flag
)

SELECT 
  mmsi,
  name,
  vessel_type,
  is_military,
  is_research,
  flag,
  current_coordinates,
  start_coordinates,
  loitering_area,
  loitering_center,
  ROUND(total_distance_moved_meters / 1852.0, 2) as total_distance_moved_nautical_miles,
  ROUND(avg_effective_speed_knots, 2) as avg_effective_speed_knots,
  total_loitering_minutes,
  position_updates,
  loitering_severity,
  risk_level,
  
  -- Alert message
  CONCAT(
    'Loitering detected: ', COALESCE(name, mmsi), ' (', vessel_type, ') ',
    'has been ', loitering_severity, ' loitering for ',
    ROUND(total_loitering_minutes / 60.0, 1), ' hours ',
    'with average speed ', ROUND(avg_effective_speed_knots, 1), ' knots ',
    '- Risk: ', risk_level
  ) as alert_message,
  
  -- Calculate loitering radius
  ROUND(ST_DISTANCE(current_coordinates, start_coordinates) / 1852.0, 2) as loitering_radius_nautical_miles
  
FROM loitering_summary
WHERE loitering_severity IN ('moderate', 'prolonged', 'extended')
ORDER BY risk_level DESC, total_loitering_minutes DESC;
