/**
 * React hook for standardized UPH data
 * Uses the new MO-first calculation keyed on (product, category, operator)
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface StandardizedUphParams {
  productName?: string;
  workCenterCategory?: 'Cutting' | 'Assembly' | 'Packaging';
  operatorId?: number;
  windowDays?: 7 | 30 | 180;
}

export interface StandardizedUphResult {
  productName: string;
  workCenterCategory: string;
  operatorId: number;
  operatorName: string;
  averageUph: number;
  moCount: number;
  totalObservations: number;
  windowDays: number;
  dataAvailable: boolean;
  message?: string;
}

export interface StandardizedUphResponse {
  success: boolean;
  data: StandardizedUphResult[];
  windowDays: number;
  timestamp: string;
}

/**
 * Hook to fetch standardized UPH data
 */
export function useStandardizedUph(params: StandardizedUphParams = {}) {
  const queryKey = [
    "/api/uph/standardized",
    params.productName,
    params.workCenterCategory,
    params.operatorId,
    params.windowDays || 30
  ];
  
  return useQuery<StandardizedUphResponse>({
    queryKey,
    queryFn: async () => {
      const queryParams = new URLSearchParams();
      if (params.productName) queryParams.append("productName", params.productName);
      if (params.workCenterCategory) queryParams.append("workCenterCategory", params.workCenterCategory);
      if (params.operatorId) queryParams.append("operatorId", params.operatorId.toString());
      queryParams.append("windowDays", (params.windowDays || 30).toString());
      
      return apiRequest("GET", `/api/uph/standardized?${queryParams.toString()}`);
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to get specific operator UPH
 */
export function useOperatorUph(
  operatorId: number,
  productName: string,
  workCenterCategory: 'Cutting' | 'Assembly' | 'Packaging',
  windowDays: 7 | 30 | 180 = 30
) {
  const queryKey = [
    `/api/uph/standardized/operator/${operatorId}`,
    productName,
    workCenterCategory,
    windowDays
  ];
  
  return useQuery({
    queryKey,
    queryFn: async () => {
      const queryParams = new URLSearchParams({
        productName,
        workCenterCategory,
        windowDays: windowDays.toString()
      });
      
      return apiRequest("GET", `/api/uph/standardized/operator/${operatorId}?${queryParams.toString()}`);
    },
    enabled: !!operatorId && !!productName && !!workCenterCategory,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to trigger UPH calculation job
 */
export function useUphCalculationJob() {
  const queryClient = useQueryClient();
  
  const calculateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/uph/standardized/calculate"),
    onSuccess: () => {
      // Invalidate all UPH queries to force refresh
      queryClient.invalidateQueries({ queryKey: ["/api/uph/standardized"] });
    }
  });
  
  const statusQuery = useQuery({
    queryKey: ["/api/uph/standardized/job-status"],
    queryFn: () => apiRequest("GET", "/api/uph/standardized/job-status"),
    refetchInterval: (data) => {
      // Poll every 2 seconds while job is running
      return data?.isRunning ? 2000 : false;
    }
  });
  
  return {
    calculate: calculateMutation.mutate,
    isCalculating: calculateMutation.isPending || statusQuery.data?.isRunning,
    status: statusQuery.data,
    error: calculateMutation.error
  };
}

/**
 * Transform standardized UPH data for analytics table display
 */
export function transformUphDataForTable(data: StandardizedUphResult[]) {
  // Group by routing (product name)
  const routingMap = new Map<string, {
    routingName: string;
    operators: Map<number, {
      operatorId: number;
      operatorName: string;
      workCenterPerformance: Record<string, number | null>;
      totalObservations: number;
    }>;
  }>();
  
  // Process each result
  data.forEach(result => {
    if (!result.dataAvailable) return;
    
    const routing = result.productName;
    if (!routingMap.has(routing)) {
      routingMap.set(routing, {
        routingName: routing,
        operators: new Map()
      });
    }
    
    const routingData = routingMap.get(routing)!;
    
    if (!routingData.operators.has(result.operatorId)) {
      routingData.operators.set(result.operatorId, {
        operatorId: result.operatorId,
        operatorName: result.operatorName,
        workCenterPerformance: {
          Cutting: null,
          Assembly: null,
          Packaging: null
        },
        totalObservations: 0
      });
    }
    
    const operatorData = routingData.operators.get(result.operatorId)!;
    operatorData.workCenterPerformance[result.workCenterCategory] = result.averageUph;
    operatorData.totalObservations += result.totalObservations;
  });
  
  // Convert to array format expected by analytics page
  const routings = Array.from(routingMap.values()).map(routing => {
    const operators = Array.from(routing.operators.values());
    
    // Calculate routing averages
    const routingAverages: Record<string, number | null> = {
      Cutting: null,
      Assembly: null,
      Packaging: null
    };
    
    ['Cutting', 'Assembly', 'Packaging'].forEach(wc => {
      const operatorsWithData = operators.filter(op => 
        op.workCenterPerformance[wc] !== null
      );
      
      if (operatorsWithData.length > 0) {
        const sum = operatorsWithData.reduce((acc, op) => 
          acc + (op.workCenterPerformance[wc] || 0), 0
        );
        routingAverages[wc] = Math.round((sum / operatorsWithData.length) * 100) / 100;
      }
    });
    
    return {
      routingName: routing.routingName,
      operators,
      routingAverages,
      totalOperators: operators.length
    };
  });
  
  // Calculate summary
  const workCenterUph = new Map<string, number[]>();
  const uniqueOperators = new Set<number>();
  
  data.forEach(result => {
    if (result.dataAvailable) {
      uniqueOperators.add(result.operatorId);
      const existing = workCenterUph.get(result.workCenterCategory) || [];
      existing.push(result.averageUph);
      workCenterUph.set(result.workCenterCategory, existing);
    }
  });
  
  const avgUphByCenter = Object.fromEntries(
    Array.from(workCenterUph.entries()).map(([wc, uphs]) => [
      wc,
      Math.round((uphs.reduce((sum, uph) => sum + uph, 0) / uphs.length) * 100) / 100,
    ])
  );
  
  return {
    routings: routings.sort((a, b) => a.routingName.localeCompare(b.routingName)),
    summary: {
      totalOperators: uniqueOperators.size,
      totalCombinations: data.filter(d => d.dataAvailable).length,
      totalRoutings: routings.length,
      avgUphByCeter: avgUphByCenter // Keep typo for backward compatibility
    },
    workCenters: ['Cutting', 'Assembly', 'Packaging']
  };
}