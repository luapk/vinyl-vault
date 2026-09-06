import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseEnabled } from '../lib/supabase.js';
import { setFeatureTierOverrides } from '../lib/pricing.js';

// Which tier each feature needs, as the database currently says.
//
// FEATURE_TIER in src/lib/pricing.js is the shipped default and stays in
// force; public.feature_tiers overrides one feature at a time, so the admin
// panel can move a gate without a deploy and the server gate reads the same
// row. The client copy exists so a locked button and a 402 from the endpoint
// agree with each other.
//
// The overrides live on the pricing module rather than in React state because
// every gate in the app already calls tierAllows(); returning a version number
// is what tells the components holding a memoised `can` to recompute.
//
// A failed read changes nothing. Clearing the map on failure would turn every
// paid feature free the first time this query fell over, which is the wrong
// direction to fail in.
export function useFeatureTiers() {
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    if (!isSupabaseEnabled) return;
    try {
      const { data, error } = await supabase.from('feature_tiers').select('feature, tier');
      if (error) return;
      const map = {};
      for (const row of data || []) map[row.feature] = row.tier;
      setFeatureTierOverrides(map);
      setVersion(v => v + 1);
    } catch {
      // Offline, or the migration has not been run. Ship defaults.
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { featureTierVersion: version, reloadFeatureTiers: load };
}
