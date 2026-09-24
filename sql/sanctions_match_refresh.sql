-- Sanctions Match Refresh Query
-- Identifies vessels that match sanctions criteria and need immediate attention
-- Used for real-time sanctions monitoring and alerting

WITH active_sanctions AS (
  SELECT 
    s.id as sanction_id,
    s.mmsi,
    s.name as sanctioned_name,
    s.reason,
    s.source,
    s.effective_date,
    s.expiry_date,
    s.is_active,
    
    -- Create search patterns for name matching
    LOWER(TRIM(s.sanctioned_name)) as search_name,
    REGEXP_REPLACE(LOWER(TRIM(s.sanctioned_name)), r'[^a-z0-9]', '') as normalized_name
    
  FROM `svalmap.marine_osint.sanctions` s
  WHERE s.is_active = TRUE
    AND (s.expiry_date IS NULL OR s.expiry_date >= CURRENT_DATE())
),

vessel_sanctions_match AS (
  SELECT 
    v.mmsi,
    v.name as vessel_name,
    v.vessel_type,
    v.is_military,
    v.is_research,
    v.flag,
    v.call_sign,
    v.imo,
    
    s.sanction_id,
    s.sanctioned_name,
    s.reason,
    s.source,
    s.effective_date,
    s.expiry_date,
    
    -- Match confidence scoring
    CASE 
      -- Exact MMSI match (highest confidence)
      WHEN v.mmsi = s.mmsi THEN 100
      
      -- Exact IMO match
      WHEN v.imo IS NOT NULL AND v.imo = REGEXP_EXTRACT(s.reason, r'IMO:?\\s*([0-9]+)') THEN 95
      
      -- Exact call sign match
      WHEN v.call_sign IS NOT NULL AND v.call_sign = REGEXP_EXTRACT(s.reason, r'Call[\\s-]?Sign:?\\s*([A-Z0-9]+)') THEN 90
      
      -- Exact name match
      WHEN LOWER(TRIM(v.name)) = s.search_name THEN 85
      
      -- Normalized name match (removes special characters)
      WHEN REGEXP_REPLACE(LOWER(TRIM(v.name)), r'[^a-z0-9]', '') = s.normalized_name THEN 80
      
      -- Partial name match (contains sanctioned name)
      WHEN LOWER(TRIM(v.name)) LIKE CONCAT('%', s.search_name, '%') THEN 70
      
      -- Sanctioned name contains vessel name
      WHEN s.search_name LIKE CONCAT('%', LOWER(TRIM(v.name)), '%') THEN 65
      
      -- Fuzzy name match (similar names)
      WHEN STRPOS(LOWER(TRIM(v.name)), s.search_name) > 0 THEN 60
      
      ELSE 0
    END as match_confidence,
    
    -- Match type classification
    CASE 
      WHEN v.mmsi = s.mmsi THEN 'exact_mmsi'
      WHEN v.imo IS NOT NULL AND v.imo = REGEXP_EXTRACT(s.reason, r'IMO:?\\s*([0-9]+)') THEN 'exact_imo'
      WHEN v.call_sign IS NOT NULL AND v.call_sign = REGEXP_EXTRACT(s.reason, r'Call[\\s-]?Sign:?\\s*([A-Z0-9]+)') THEN 'exact_call_sign'
      WHEN LOWER(TRIM(v.name)) = s.search_name THEN 'exact_name'
      WHEN REGEXP_REPLACE(LOWER(TRIM(v.name)), r'[^a-z0-9]', '') = s.normalized_name THEN 'normalized_name'
      WHEN LOWER(TRIM(v.name)) LIKE CONCAT('%', s.search_name, '%') THEN 'partial_name'
      WHEN s.search_name LIKE CONCAT('%', LOWER(TRIM(v.name)), '%') THEN 'reverse_partial'
      WHEN STRPOS(LOWER(TRIM(v.name)), s.search_name) > 0 THEN 'fuzzy_name'
      ELSE 'no_match'
    END as match_type
    
  FROM `svalmap.marine_osint.vessels` v
  CROSS JOIN active_sanctions s
  WHERE v.mmsi IS NOT NULL
),

sanctions_alerts AS (
  SELECT 
    mmsi,
    vessel_name,
    vessel_type,
    is_military,
    is_research,
    flag,
    call_sign,
    imo,
    
    sanction_id,
    sanctioned_name,
    reason,
    source,
    effective_date,
    expiry_date,
    match_confidence,
    match_type,
    
    -- Risk assessment based on match confidence and vessel type
    CASE 
      WHEN match_confidence >= 90 THEN 'critical'
      WHEN match_confidence >= 80 THEN 'high'
      WHEN match_confidence >= 70 THEN 'medium'
      WHEN match_confidence >= 60 THEN 'low'
      ELSE 'minimal'
    END as alert_severity,
    
    -- Additional risk factors
    CASE 
      WHEN is_military = TRUE THEN 'military_vessel'
      WHEN is_research = TRUE THEN 'research_vessel'
      WHEN flag IN ('RU', 'CN', 'IR', 'KP') THEN 'high_risk_flag'
      WHEN vessel_type IN ('tanker', 'cargo') THEN 'commercial_vessel'
      ELSE 'standard_vessel'
    END as risk_factors,
    
    -- Alert message
    CONCAT(
      'Sanctions match detected: ', vessel_name, ' (', vessel_type, ') ',
      'matches sanctioned entity ', sanctioned_name, ' ',
      'with ', match_confidence, '% confidence (', match_type, ') ',
      '- Source: ', source, ' - Risk: ', alert_severity
    ) as alert_message,
    
    -- Last known position
    (SELECT vp.coordinates 
     FROM `svalmap.marine_osint.vessel_positions` vp 
     WHERE vp.mmsi = vsm.mmsi 
       AND vp.partition_date = CURRENT_DATE()
     ORDER BY vp.timestamp DESC 
     LIMIT 1) as last_known_position,
    
    -- Last position timestamp
    (SELECT vp.timestamp 
     FROM `svalmap.marine_osint.vessel_positions` vp 
     WHERE vp.mmsi = vsm.mmsi 
       AND vp.partition_date = CURRENT_DATE()
     ORDER BY vp.timestamp DESC 
     LIMIT 1) as last_position_timestamp
    
  FROM vessel_sanctions_match vsm
  WHERE match_confidence >= 60 -- Only include meaningful matches
)

SELECT 
  mmsi,
  vessel_name,
  vessel_type,
  is_military,
  is_research,
  flag,
  call_sign,
  imo,
  
  sanction_id,
  sanctioned_name,
  reason,
  source,
  effective_date,
  expiry_date,
  match_confidence,
  match_type,
  alert_severity,
  risk_factors,
  alert_message,
  last_known_position,
  last_position_timestamp,
  
  -- Days since sanction was effective
  DATE_DIFF(CURRENT_DATE(), effective_date, DAY) as days_since_effective,
  
  -- Days until sanction expires (NULL if no expiry)
  CASE 
    WHEN expiry_date IS NOT NULL THEN DATE_DIFF(expiry_date, CURRENT_DATE(), DAY)
    ELSE NULL
  END as days_until_expiry,
  
  -- Urgency indicator
  CASE 
    WHEN match_confidence >= 90 THEN 'immediate'
    WHEN match_confidence >= 80 THEN 'urgent'
    WHEN match_confidence >= 70 THEN 'high'
    WHEN match_confidence >= 60 THEN 'normal'
    ELSE 'low'
  END as urgency_level
  
FROM sanctions_alerts
ORDER BY match_confidence DESC, alert_severity DESC, days_since_effective DESC;
