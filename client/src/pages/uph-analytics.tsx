import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Users, Target, TrendingUp, RefreshCw, Calculator, Search } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface UphTableData {
  routings: Array<{
    routingName: string;
    operators: Array<{
      operatorId: number;
      operatorName: string;
      workCenterPerformance: Record<string, number | null>;
      totalObservations: number;
    }>;
    routingAverages: Record<string, number | null>;
    totalOperators: number;
  }>;
  summary: {
    totalOperators: number;
    totalCombinations: number;
    totalRoutings: number;
    avgUphByCeter: Record<string, number>;
    noDataReason?: string;
  };
  workCenters: string[];
}

export default function UphAnalytics() {
  const queryClient = useQueryClient();
  const [expandedRoutings, setExpandedRoutings] = useState<Set<string>>(new Set());
  const [aiOptimized, setAiOptimized] = useState<boolean>(false);

  // Get UPH table data
  const { data: uphData, isLoading: uphLoading } = useQuery<UphTableData>({
    queryKey: ["/api/uph/table-data"],
  });

  // Unified status state
  const [currentOperation, setCurrentOperation] = useState<string | null>(null);

  // Fix observations calculation
  const fixObservationsMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/uph/fix-observations"),
    onMutate: () => setCurrentOperation("Fixing observations..."),
    onSuccess: (data) => {
      console.log("Fixed UPH observations:", data);
      queryClient.invalidateQueries({ queryKey: ["/api/uph/table-data"] });
      setCurrentOperation(null);
    },
    onError: () => setCurrentOperation(null),
  });

  // Single UPH calculation from work cycles
  const calculateUphMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/uph/calculate"),
    onMutate: () => setCurrentOperation("Calculating UPH..."),
    onSuccess: (data) => {
      console.log("UPH calculation completed:", data);
      queryClient.invalidateQueries({ queryKey: ["/api/uph/table-data"] });
      setCurrentOperation(null);
    },
    onError: () => setCurrentOperation(null),
  });

  // AI anomaly detection
  const detectAnomaliesMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/uph/detect-anomalies"),
    onMutate: () => setCurrentOperation("Detecting anomalies..."),
    onSuccess: (data) => {
      console.log("Anomaly detection completed:", data);
      setCurrentOperation(null);
    },
    onError: () => setCurrentOperation(null),
  });

  // Clean UPH calculation with AI filtering
  const calculateCleanUphMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/uph/calculate-clean"),
    onMutate: () => setCurrentOperation("Calculating AI-filtered UPH..."),
    onSuccess: (data) => {
      console.log("Clean UPH calculation completed:", data);
      queryClient.invalidateQueries({ queryKey: ["/api/uph/table-data"] });
      setCurrentOperation(null);
    },
    onError: () => setCurrentOperation(null),
  });

  // Check if any operation is running
  const isAnyOperationRunning = fixObservationsMutation.isPending || 
                                calculateUphMutation.isPending || 
                                detectAnomaliesMutation.isPending || 
                                calculateCleanUphMutation.isPending;

  // Refresh handler - uses AI optimization when toggle is enabled
  const handleRefresh = () => {
    if (aiOptimized) {
      // Run AI-optimized refresh: detect anomalies then calculate clean UPH
      calculateCleanUphMutation.mutate();
    } else {
      // Simple refresh: just recalculate UPH
      calculateUphMutation.mutate();
    }
  };

  const toggleRouting = (routingName: string) => {
    const newExpanded = new Set(expandedRoutings);
    if (newExpanded.has(routingName)) {
      newExpanded.delete(routingName);
    } else {
      newExpanded.add(routingName);
    }
    setExpandedRoutings(newExpanded);
  };

  const formatUph = (uph: number | null) => {
    if (uph === null || uph === undefined) return "-";
    return uph.toFixed(1);
  };

  // Calculate routing + work center specific color ranges (context-specific conditional formatting)
  const getRoutingWorkCenterPercentiles = (routingName: string, workCenter: string) => {
    if (!uphData?.routings) return { p55: 50, p45: 25 };
    
    // Find the specific routing
    const routing = uphData.routings.find(r => r.routingName === routingName);
    if (!routing) return { p55: 50, p45: 25 };
    
    // Get all UPH values for this specific routing + work center combination
    const uphValuesForContext: number[] = [];
    routing.operators.forEach(operator => {
      const uphValue = operator.workCenterPerformance[workCenter];
      if (uphValue !== null && uphValue !== undefined && uphValue > 0) {
        uphValuesForContext.push(uphValue);
      }
    });

    if (uphValuesForContext.length === 0) return { p55: 50, p45: 25 };
    
    uphValuesForContext.sort((a, b) => a - b);
    
    // Calculate percentiles for red-black-green scale:
    // Bottom 45% = red, Median ±5% = black, Top 45% = green
    const p45Index = Math.floor(uphValuesForContext.length * 0.45);
    const p55Index = Math.floor(uphValuesForContext.length * 0.55);
    
    const p45 = uphValuesForContext[p45Index] || 25; // 45th percentile
    const p55 = uphValuesForContext[p55Index] || 50; // 55th percentile
    
    return { p55, p45 };
  };

  const getUphBadgeVariant = (uph: number | null, workCenter?: string, routingName?: string) => {
    if (uph === null || uph === undefined) return "outline";
    
    if (workCenter && routingName) {
      const { p55, p45 } = getRoutingWorkCenterPercentiles(routingName, workCenter);
      if (uph >= p55) return "uphHigh"; // Green for top 45%
      if (uph >= p45) return "uphMedium"; // Black/gray for median ±5%
      return "uphLow"; // Red for bottom 45%
    }
    
    // Fallback to global thresholds if context not specified
    if (uph >= 50) return "uphHigh";
    if (uph >= 25) return "uphMedium";
    return "uphLow";
  };

  // Order work centers consistently: Cutting, Assembly, Packaging
  const getOrderedWorkCenters = (workCenters: string[]) => {
    const order = ['Cutting', 'Assembly', 'Packaging'];
    return workCenters.sort((a, b) => {
      const aIndex = order.indexOf(a);
      const bIndex = order.indexOf(b);
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  };

  if (uphLoading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-8 h-8 animate-spin mr-2" />
          <span>Loading UPH analytics...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">UPH Analytics</h1>
          <p className="text-gray-600">Units Per Hour performance metrics organized by product routing</p>
          
          {/* Unified Status Indicator */}
          {(isAnyOperationRunning || currentOperation) && (
            <div className="flex items-center mt-2 text-sm text-blue-600">
              <div className="flex items-center">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse mr-2" />
                <span className="font-medium">Live</span>
                {currentOperation && (
                  <span className="ml-2 text-gray-600">• {currentOperation}</span>
                )}
              </div>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-4">
          {/* AI Optimized Toggle */}
          <div className="flex items-center space-x-2">
            <Switch
              id="ai-optimized"
              checked={aiOptimized}
              onCheckedChange={setAiOptimized}
            />
            <Label htmlFor="ai-optimized" className="text-sm">AI Optimized</Label>
          </div>
          
          {/* Refresh Button */}
          <Button
            onClick={handleRefresh}
            disabled={isAnyOperationRunning}
            variant="default"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {uphData?.summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <Users className="h-4 w-4 text-muted-foreground" />
                <div className="ml-2">
                  <p className="text-sm font-medium leading-none">Total Operators</p>
                  <p className="text-2xl font-bold">{uphData.summary.totalOperators}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <Target className="h-4 w-4 text-muted-foreground" />
                <div className="ml-2">
                  <p className="text-sm font-medium leading-none">UPH Calculations</p>
                  <p className="text-2xl font-bold">{uphData.summary.totalCombinations}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <div className="ml-2">
                  <p className="text-sm font-medium leading-none">Product Routings</p>
                  <p className="text-2xl font-bold">{uphData.summary.totalRoutings}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <Calculator className="h-4 w-4 text-muted-foreground" />
                <div className="ml-2">
                  <p className="text-sm font-medium leading-none">Avg UPH</p>
                  <p className="text-2xl font-bold">
                    {(() => {
                      const values = Object.values(uphData.summary.avgUphByCeter || {}).filter(v => v !== null && v !== undefined);
                      return values.length > 0 
                        ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
                        : "N/A";
                    })()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* UPH Table by Product Routing */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Performance by Product Routing
          </CardTitle>
          <CardDescription>
            UPH metrics organized by product routing. Click chevrons to expand operator details.
            {uphData?.summary?.noDataReason && (
              <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-md">
                <p className="text-amber-800 text-sm">{uphData.summary.noDataReason}</p>
              </div>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {uphData && uphData.routings && uphData.routings.length > 0 ? (
            <div className="space-y-4">
              {[...uphData.routings]
                .sort((a, b) => {
                  // Calculate total observations per routing
                  const totalObsA = a.operators.reduce((sum, op) => sum + op.totalObservations, 0);
                  const totalObsB = b.operators.reduce((sum, op) => sum + op.totalObservations, 0);
                  // Sort descending (most observations first)
                  return totalObsB - totalObsA;
                })
                .map((routing) => (
                <Collapsible
                  key={routing.routingName}
                  open={expandedRoutings.has(routing.routingName)}
                  onOpenChange={() => toggleRouting(routing.routingName)}
                >
                  <div className="border rounded-lg">
                    <CollapsibleTrigger className="w-full p-4 text-left hover:bg-muted/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {expandedRoutings.has(routing.routingName) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                          <div>
                            <h3 className="font-semibold text-lg">{routing.routingName}</h3>
                            <p className="text-sm text-muted-foreground">
                              {routing.totalOperators} operators • {routing.operators.reduce((sum, op) => sum + op.totalObservations, 0)} total observations
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {getOrderedWorkCenters(uphData.workCenters)
                            .filter((wc) => routing.routingAverages[wc] !== null && routing.routingAverages[wc] !== undefined)
                            .map((wc) => (
                            <Badge
                              key={wc}
                              variant={getUphBadgeVariant(routing.routingAverages[wc], wc, routing.routingName)}
                            >
                              {wc}: {formatUph(routing.routingAverages[wc])}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-4 pb-4">
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead>
                              <tr className="border-b">
                                <th className="text-left py-2 font-medium">Operator</th>
                                {getOrderedWorkCenters(uphData.workCenters)
                                  .filter((wc) => routing.routingAverages[wc] !== null && routing.routingAverages[wc] !== undefined)
                                  .map((wc) => (
                                  <th key={wc} className="text-center py-2 font-medium">
                                    {wc}
                                  </th>
                                ))}
                                <th className="text-center py-2 font-medium">Observations</th>
                              </tr>
                            </thead>
                            <tbody>
                              {routing.operators.map((operator) => (
                                <tr key={operator.operatorId} className="border-b">
                                  <td className="py-2 font-medium">{operator.operatorName}</td>
                                  {getOrderedWorkCenters(uphData.workCenters)
                                    .filter((wc) => routing.routingAverages[wc] !== null && routing.routingAverages[wc] !== undefined)
                                    .map((wc) => (
                                    <td key={wc} className="text-center py-2">
                                      <Badge
                                        variant={getUphBadgeVariant(operator.workCenterPerformance[wc], wc, routing.routingName)}
                                        className="min-w-[60px]"
                                      >
                                        {formatUph(operator.workCenterPerformance[wc])}
                                      </Badge>
                                    </td>
                                  ))}
                                  <td className="text-center py-2">
                                    <span className="text-sm text-muted-foreground">
                                      {operator.totalObservations}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Calculator className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-medium mb-2">No UPH Data Available</h3>
              <p className="text-sm text-gray-400 mb-4">
                Click "Calculate UPH" to generate performance metrics from work cycles data.
              </p>
              <Button
                onClick={() => calculateUphMutation.mutate()}
                disabled={calculateUphMutation.isPending}
              >
                {calculateUphMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                Calculate UPH
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Work Center Averages Summary */}
      {uphData?.summary?.avgUphByCeter && Object.keys(uphData.summary.avgUphByCeter).length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Work Center Performance Summary</CardTitle>
            <CardDescription>
              Average UPH across all operators and routings by work center
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(uphData.summary.avgUphByCeter).map(([workCenter, avgUph]) => (
                <div key={workCenter} className="text-center p-4 border rounded-lg">
                  <h3 className="font-medium text-sm text-muted-foreground mb-1">{workCenter}</h3>
                  <p className="text-2xl font-bold">{avgUph.toFixed(1)}</p>
                  <p className="text-xs text-muted-foreground">units/hour</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}