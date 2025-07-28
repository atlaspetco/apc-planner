import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Users, Target, TrendingUp, RefreshCw, Calculator, Search } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { UphCalculationModal } from "@/components/dashboard/uph-calculation-modal";
import { useStandardizedUph, useUphCalculationJob, transformUphDataForTable } from "@/hooks/useStandardizedUph";

interface OperatorPerformance {
  operatorId: number;
  operatorName: string;
  workCenterPerformance: Record<string, number | null>;
  workCenterUphValues?: Record<string, number[]>;
  totalObservations: number;
}

interface UphTableData {
  routings: Array<{
    routingName: string;
    operators: Array<OperatorPerformance>;
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

interface RawUphData {
  id: number;
  operatorId: number;
  operatorName: string;
  workCenter: string;
  operation: string;
  routing: string;
  uph: number;
  observationCount: number;
  totalDurationHours: number;
  totalQuantity: number;
  dataSource: string;
  lastUpdated: string;
}

function transformRawUphData(rawData: RawUphData[] | any): UphTableData {
  // Ensure rawData is an array
  if (!Array.isArray(rawData)) {
    console.error("transformRawUphData: rawData is not an array:", rawData);
    return {
      routings: [],
      summary: {
        totalOperators: 0,
        totalCombinations: 0,
        totalRoutings: 0,
        avgUphByCeter: {},
        noDataReason: "Invalid data format"
      },
      workCenters: ['Cutting', 'Assembly', 'Packaging']
    };
  }

  // Group by routing
  const routingMap = new Map<string, {
    routingName: string;
    operators: Map<string, OperatorPerformance>;
  }>();
  
  // Process each record
  rawData.forEach(record => {
    const routing = record.productRouting || record.routing; // Handle both field names
    if (!routing) return; // Skip records without routing
    
    if (!routingMap.has(routing)) {
      routingMap.set(routing, {
        routingName: routing,
        operators: new Map()
      });
    }
    
    const routingData = routingMap.get(routing)!;
    
    // Use operator name as key since all IDs are 0
    if (!routingData.operators.has(record.operatorName)) {
      routingData.operators.set(record.operatorName, {
        operatorId: record.operatorId,
        operatorName: record.operatorName,
        workCenterPerformance: {},
        workCenterUphValues: {},
        totalObservations: 0
      });
    }
    
    const operatorData = routingData.operators.get(record.operatorName)!;
    
    // Initialize work center arrays if they don't exist
    if (!operatorData.workCenterUphValues[record.workCenter]) {
      operatorData.workCenterUphValues[record.workCenter] = [];
      operatorData.workCenterPerformance[record.workCenter] = null;
    }
    
    // Skip empty work centers
    if (record.workCenter) {
      operatorData.workCenterUphValues[record.workCenter].push(record.uph);
      operatorData.totalObservations += record.observationCount;
    }
  });
  
  // Get all unique work centers from the data
  const allWorkCenters = new Set<string>();
  rawData.forEach(record => {
    if (record.workCenter) {
      allWorkCenters.add(record.workCenter);
    }
  });
  const workCenters = Array.from(allWorkCenters).sort();
  
  // Convert to array format and calculate averages
  const routings = Array.from(routingMap.values()).map(routing => {
    const operators = Array.from(routing.operators.values()).map(operator => {
      // Calculate averages for each work center from collected UPH values
      Object.entries(operator.workCenterUphValues || {}).forEach(([wc, values]) => {
        if (values && values.length > 0) {
          const average = values.reduce((sum: number, uph: number) => sum + uph, 0) / values.length;
          operator.workCenterPerformance[wc] = Math.round(average * 100) / 100;
        }
      });
      
      return operator;
    });
    
    // Calculate routing averages
    const routingAverages: Record<string, number | null> = {};
    
    workCenters.forEach(wc => {
      const operatorsWithData = operators.filter(op => 
        op.workCenterPerformance[wc] !== null && op.workCenterPerformance[wc] !== undefined
      );
      
      if (operatorsWithData.length > 0) {
        const sum = operatorsWithData.reduce((acc, op) => 
          acc + (op.workCenterPerformance[wc] || 0), 0
        );
        routingAverages[wc] = Math.round((sum / operatorsWithData.length) * 100) / 100;
      } else {
        routingAverages[wc] = null;
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
  
  rawData.forEach(record => {
    uniqueOperators.add(record.operatorId);
    const existing = workCenterUph.get(record.workCenter) || [];
    existing.push(record.uph);
    workCenterUph.set(record.workCenter, existing);
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
      totalCombinations: rawData.length,
      totalRoutings: routings.length,
      avgUphByCeter: avgUphByCenter
    },
    workCenters: workCenters
  };
}

export default function UphAnalytics() {
  const queryClient = useQueryClient();
  const [expandedRoutings, setExpandedRoutings] = useState<Set<string>>(new Set());
  const [aiOptimized, setAiOptimized] = useState<boolean>(false);
  const [anomalyFilter, setAnomalyFilter] = useState<"none" | "2percent" | "10percent">("none");
  // UPH Analytics always shows ALL data - no time filtering
  const [selectedUphDetails, setSelectedUphDetails] = useState<{
    operatorName: string;
    workCenter: string;
    routing: string;
    uphValue: number;
  } | null>(null);

  // Get UPH data from historical table
  const { data: rawUphData, isLoading: uphLoading, isRefetching, refetch } = useQuery({
    queryKey: ["/api/uph/table-data"],
    queryFn: async () => {
      const response = await fetch("/api/uph/table-data");
      if (!response.ok) throw new Error("Failed to fetch UPH data");
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  // Transform raw UPH data to table format
  const uphData = (() => {
    console.log("Raw UPH data:", rawUphData);
    if (!rawUphData) return null;
    
    // The table-data endpoint returns the data already formatted
    if (rawUphData.routings && rawUphData.summary && rawUphData.workCenters) {
      console.log("Using pre-formatted table data:", rawUphData);
      return rawUphData;
    }
    
    // Fallback to array processing if needed
    let dataArray = Array.isArray(rawUphData) ? rawUphData : rawUphData.data || [];
    if (!Array.isArray(dataArray)) {
      console.error("UPH data is not in expected format:", rawUphData);
      return null;
    }
    
    // Apply anomaly filtering if selected
    if (anomalyFilter !== "none" && dataArray.length > 0) {
      const percentileToRemove = anomalyFilter === "2percent" ? 0.02 : 0.10;
      
      // Group by work center + routing for more accurate filtering
      const groupedData = new Map<string, RawUphData[]>();
      dataArray.forEach(record => {
        const key = `${record.workCenter}|${record.routing}`;
        if (!groupedData.has(key)) {
          groupedData.set(key, []);
        }
        groupedData.get(key)!.push(record);
      });
      
      const filteredData: RawUphData[] = [];
      
      // For each work center + routing combination, filter out top and bottom percentiles
      groupedData.forEach((records, key) => {
        if (records.length < 3) {
          // Not enough data to filter, keep all
          filteredData.push(...records);
          return;
        }
        
        // Sort by UPH
        const sortedRecords = [...records].sort((a, b) => a.uph - b.uph);
        const n = sortedRecords.length;
        
        // Calculate how many to remove from each end
        const removeCount = Math.max(1, Math.floor(n * percentileToRemove));
        
        // Keep records that are not in the top or bottom percentile
        const keepRecords = sortedRecords.slice(removeCount, n - removeCount);
        
        console.log(`${key}: Removing ${removeCount} from each end (total ${n} records, keeping ${keepRecords.length})`);
        console.log(`  Removed bottom: ${sortedRecords.slice(0, removeCount).map(r => `${r.operatorName}:${r.uph.toFixed(1)}`).join(", ")}`);
        console.log(`  Removed top: ${sortedRecords.slice(n - removeCount).map(r => `${r.operatorName}:${r.uph.toFixed(1)}`).join(", ")}`);
        
        filteredData.push(...keepRecords);
      });
      
      console.log(`Filtered ${dataArray.length - filteredData.length} records out of ${dataArray.length} using ${anomalyFilter} filter`);
      dataArray = filteredData;
    }
    
    console.log("Processing", dataArray.length, "UPH records");
    const result = transformRawUphData(dataArray);
    console.log("Transformed data:", result);
    return result;
  })();

  // Use standardized UPH calculation job
  const { calculate, isCalculating, status: jobStatus } = useUphCalculationJob();

  // AI anomaly detection (keep for now)
  const detectAnomaliesMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/uph/detect-anomalies"),
    onSuccess: (data) => {
      console.log("Anomaly detection completed:", data);
    },
  });

  // Clean UPH calculation with AI filtering (keep for now)
  const calculateCleanUphMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/uph/calculate-clean"),
    onSuccess: (data) => {
      console.log("Clean UPH calculation completed:", data);
      queryClient.invalidateQueries({ queryKey: ["/api/uph/standardized"] });
    },
  });

  // Check if any operation is running
  const isAnyOperationRunning = isCalculating || 
                                detectAnomaliesMutation.isPending || 
                                calculateCleanUphMutation.isPending;

  // Refresh handler - refreshes the UPH data
  const handleRefresh = () => {
    console.log('UPH Analytics refresh initiated - reloading historical UPH data');
    // Directly refetch the UPH data
    refetch();
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

  // Get min/max values for each routing + work center context (only highlight extreme values)
  const getRoutingWorkCenterExtremes = (routingName: string, workCenter: string) => {
    if (!uphData?.routings) return { max: null, min: null };
    
    // Find the specific routing
    const routing = uphData.routings.find(r => r.routingName === routingName);
    if (!routing) return { max: null, min: null };
    
    // Get all UPH values for this specific routing + work center combination
    const uphValuesForContext: number[] = [];
    routing.operators.forEach(operator => {
      const uphValue = operator.workCenterPerformance[workCenter];
      if (uphValue !== null && uphValue !== undefined && uphValue > 0) {
        uphValuesForContext.push(uphValue);
      }
    });

    if (uphValuesForContext.length === 0) return { max: null, min: null };
    
    const max = Math.max(...uphValuesForContext);
    const min = Math.min(...uphValuesForContext);
    
    return { max, min };
  };

  const getUphBadgeVariant = (uph: number | null, workCenter?: string, routingName?: string) => {
    if (uph === null || uph === undefined) return "outline";
    
    if (workCenter && routingName) {
      const { max, min } = getRoutingWorkCenterExtremes(routingName, workCenter);
      
      // Only color the single highest (green) and single lowest (red) values
      if (max !== null && uph === max) return "uphHigh"; // Green for single highest
      if (min !== null && uph === min) return "uphLow"; // Red for single lowest
      return "uphMedium"; // Gray for everything else
    }
    
    // No coloring for product totals - return neutral
    return "outline";
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

  // Debug logging
  console.log("UPH Analytics Render State:", {
    uphLoading,
    rawUphData,
    uphData,
    hasRoutings: uphData?.routings?.length > 0,
    routingsLength: uphData?.routings?.length || 0
  });

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">UPH Analytics</h1>
          <p className="text-gray-600">Units Per Hour performance metrics organized by product routing</p>
          
          {/* Unified Status Indicator */}
          {isAnyOperationRunning && (
            <div className="flex items-center mt-2 text-sm text-blue-600">
              <div className="flex items-center">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse mr-2" />
                <span className="font-medium">Live</span>
                <span className="ml-2 text-gray-600">• Calculating UPH...</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-4">

          
          {/* Anomaly Settings Dropdown */}
          <div className="flex items-center space-x-2">
            <Label htmlFor="anomaly-filter" className="text-sm">Anomaly Settings:</Label>
            <Select value={anomalyFilter} onValueChange={(value: "none" | "2percent" | "10percent") => setAnomalyFilter(value)}>
              <SelectTrigger id="anomaly-filter" className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No filtering</SelectItem>
                <SelectItem value="2percent">Remove top/bottom 2%</SelectItem>
                <SelectItem value="10percent">Remove top/bottom 10%</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {/* Refresh Button */}
          <Button
            onClick={handleRefresh}
            disabled={isRefetching}
            variant="default"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
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
          {(uphData?.routings && uphData.routings.length > 0) ? (
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
                          {getOrderedWorkCenters(uphData.workCenters).map((wc) => (
                            <Badge
                              key={wc}
                              variant="outline"
                              className="text-base font-medium"
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
                                {getOrderedWorkCenters(uphData.workCenters).map((wc) => (
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
                                  {getOrderedWorkCenters(uphData.workCenters).map((wc) => (
                                    <td key={wc} className="text-center py-2 pt-[4px] pb-[4px]">
                                      <Badge
                                        variant={getUphBadgeVariant(operator.workCenterPerformance[wc], wc, routing.routingName)}
                                        className="inline-flex items-center rounded-full border px-2.5 py-0.5 font-semibold focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-red-200 text-red-800 hover:bg-red-300 min-w-[60px] cursor-pointer hover:opacity-80 transition-opacity pt-[6px] pb-[6px] text-[14px]"
                                        onClick={() => {
                                          if (operator.workCenterPerformance[wc]) {
                                            setSelectedUphDetails({
                                              operatorName: operator.operatorName,
                                              workCenter: wc,
                                              routing: routing.routingName,
                                              uphValue: operator.workCenterPerformance[wc]
                                            });
                                          }
                                        }}
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
                onClick={() => calculate()}
                disabled={isCalculating}
              >
                {isCalculating ? (
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
                  <p className="text-2xl font-bold">{avgUph?.toFixed(1) || '0.0'}</p>
                  <p className="text-xs text-muted-foreground">units/hour</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      {/* UPH Calculation Details Modal */}
      {selectedUphDetails && (
        <UphCalculationModal
          isOpen={true}
          onClose={() => setSelectedUphDetails(null)}
          operatorName={selectedUphDetails.operatorName}
          workCenter={selectedUphDetails.workCenter}
          routing={selectedUphDetails.routing}
          uphValue={selectedUphDetails.uphValue}
        />
      )}
    </div>
  );
}