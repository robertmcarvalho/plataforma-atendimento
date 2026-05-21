'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import {
  DEFAULT_AI_FEATURES,
  mergeAiFeatures,
  type AiFeaturesState,
} from './defaults';

export type { AiFeaturesState };

export function useAiFeatures(enabled = true) {
  return useQuery({
    queryKey: ['global-app-settings', 'ai-features'],
    queryFn: async () => {
      const response = await api.get<Record<string, unknown>>('/api/settings');
      return mergeAiFeatures(response.data.ai_features_config);
    },
    staleTime: 10_000,
    enabled,
  });
}

export function useMergedAiFeatures(enabled = true): AiFeaturesState {
  const q = useAiFeatures(enabled);
  return q.data ?? DEFAULT_AI_FEATURES;
}
