import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, Clock, TrendingUp, Expand, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OperatorWorkloadDetailModal } from './operator-workload-detail-modal';

interface OperatorWorkload {
  operatorId: number;
  operatorName: string;
  totalAssignments: number;
  totalEstimatedHours: number;
  totalCompletedHours: number;
  availableHours: number;
  capacityPercent: number;
  observations: number;
  estimatedCompletion: string;
}

interface OperatorData {
  id: number;
  name: string;
  availableHours: number;
  observations?: number;
}

interface UphEntry {
  id?: number;
  operatorId?: number;
  operatorName: string; // The operator name
  workCenter: string;
  productRouting: string; // The product routing
  operation?: string;
  uph: number; // The UPH value
  observationCount?: number;
  observations?: number;
  totalQuantity?: number;
  totalHours?: number;
  dataSource?: string;
  lastCalculated?: string;
}

interface OperatorWorkloadSummaryProps {
  assignments: Map<number, any>;
  assignmentsData?: any;
}

export function OperatorWorkloadSummary({ assignments, assignmentsData }: OperatorWorkloadSummaryProps) {
  const [selectedOperator, setSelectedOperator] = useState<any | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Fetch operator data for workload calculations
  const { data: operatorsData } = useQuery<OperatorData[] | { operators: OperatorData[] }>({
    queryKey: ["/api/operators"],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch UPH data for more accurate time calculations
  const { data: uphResults, isLoading: isLoadingUph } = useQuery<UphEntry[] | undefined>({
    queryKey: ["/api/uph-data"],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
  
  React.useEffect(() => {
    if (uphResults) {
      console.log('UPH data loaded:', uphResults.length, 'entries');
      const evanUph = uphResults.filter((d: any) => d.operatorName === "Evan Crosby");
      console.log('Evan Crosby UPH entries:', evanUph.length);
      console.log('Sample Evan UPH:', evanUph.slice(0, 3));
    }
  }, [uphResults]);

  // Calculate workload summary from assignments
  const workloadSummary = React.useMemo(() => {
    // Handle both direct array and wrapped operators response
    const operators = Array.isArray(operatorsData) 
      ? operatorsData 
      : (operatorsData?.operators || []);
    if (!assignmentsData?.assignments || !operators.length) return [];

    console.log('Processing assignments:', assignmentsData.assignments.length);
    console.log('UPH data available:', uphResults?.length || 0);
    
    // Debug Evan's assignments specifically
    const evanAssignments = assignmentsData.assignments.filter((a: any) => a.operatorName === "Evan Crosby");
    console.log(`Evan Crosby has ${evanAssignments.length} assignments:`, evanAssignments.slice(0, 3));
    
    // Debug log some sample UPH data
    if (uphResults && uphResults.length > 0) {
      const sampleUph = uphResults.slice(0, 3);
      console.log('Sample UPH data:', sampleUph);
    }

    const operatorMap = new Map<number, any>();
    operators.forEach((op: OperatorData) => {
      operatorMap.set(op.id, {
        operatorId: op.id,
        operatorName: op.name,
        totalAssignments: 0,
        totalEstimatedHours: 0,
        totalCompletedHours: 0, // Add completed hours tracking
        availableHours: op.availableHours || 40, // Default 40h/week
        observations: op.observations || 0,
        assignments: [],
        productSummary: new Map() // Group by product routing
      });
      
      // Debug operator creation
      if (op.name === "Evan Crosby") {
        console.log(`Created Evan in operatorMap: ID=${op.id}, name=${op.name}`);
      }
    });

    // Process assignments to calculate workload using UPH data
    assignmentsData.assignments.forEach((assignment: any) => {
      // Debug specific work order
      if (assignment.workOrderId === 33915) {
        console.log('Processing work order 33915:', assignment);
      }
      
      // Debug Evan's assignments
      if (assignment.operatorName === "Evan Crosby") {
        console.log(`Evan assignment: operatorId=${assignment.operatorId}, routing=${assignment.productRouting || assignment.routing}, workCenter=${assignment.workCenter}, qty=${assignment.quantity}`);
      }
      
      const operator = operatorMap.get(assignment.operatorId);
      if (!operator && assignment.operatorName === "Evan Crosby") {
        console.log(`ERROR: Evan not found in operatorMap! operatorId=${assignment.operatorId}, Map keys:`, Array.from(operatorMap.keys()));
      }
      if (operator) {
        operator.totalAssignments++;
        // Store assignment data for later hours calculation
        const assignmentData = {
          ...assignment,
          // Ensure all required fields are present
          productRouting: assignment.productRouting || assignment.routing || 'Unknown',
          workCenter: assignment.workCenter || 'Unknown',
          quantity: assignment.quantity || 0,
          productionOrderId: assignment.productionOrderId || null,
          estimatedHours: 0 // Will be calculated below
        };
        operator.assignments.push(assignmentData);
        
        // Aggregate by product routing
        const routing = assignment.productRouting || assignment.routing || 'Unknown';
        const workCenter = assignment.workCenter || 'Unknown';
        const key = `${routing}|${workCenter}`;
        
        if (!operator.productSummary.has(key)) {
          operator.productSummary.set(key, {
            routing,
            workCenter,
            totalQuantity: 0,
            estimatedHours: 0,
            uph: 0
          });
        }
        
        const productData = operator.productSummary.get(key);
        productData.totalQuantity += assignment.quantity || 0;
        
        // Only include hours for non-finished work orders
        // Debug workOrderState for Evan
        if (operator.operatorName === "Evan Crosby") {
          console.log(`Evan's assignment processing:`, {
            workOrderId: assignment.workOrderId,
            workOrderState: assignment.workOrderState,
            workCenter: assignment.workCenter, 
            routing: routing,
            quantity: assignment.quantity,
            operatorId: assignment.operatorId,
            operatorName: operator.operatorName
          });
        }
        
        // Include all work orders except explicitly finished ones
        // null state should be treated as active/in-progress
        if (assignment.workOrderState !== 'finished') {
          // Calculate estimated hours based on UPH data if available
          let estimatedHours = 0;
          if (uphResults && uphResults.length > 0 && assignment.quantity > 0) {
            // Debug: log what we're searching for
            if (operator.operatorName === "Evan Crosby") {
              console.log(`Searching UPH for Evan: operator="${operator.operatorName}", workCenter="${workCenter}", routing="${routing}"`);
              
              // Log all Evan's UPH entries to see what's available
              const evanUphData = uphResults.filter((e: any) => (e.operator === "Evan Crosby" || e.operatorName === "Evan Crosby"));
              console.log(`Evan's UPH data (${evanUphData.length} entries):`, evanUphData);
              
              // Check if there's a name mismatch
              const hasEvanInUph = uphResults.some((e: any) => (e.operator === "Evan Crosby" || e.operatorName === "Evan Crosby"));
              console.log(`UPH data has "Evan Crosby": ${hasEvanInUph}`);
            }
            
            // First try exact match
            let uphEntry = uphResults.find((entry: any) => 
              entry.operatorName === operator.operatorName &&
              entry.workCenter === workCenter &&
              entry.productRouting === routing
            );
            
            // If no exact match, try to find same operator and work center (any routing)
            if (!uphEntry) {
              const workCenterMatches = uphResults.filter((entry: any) => 
                entry.operatorName === operator.operatorName &&
                entry.workCenter === workCenter
              );
              
              if (workCenterMatches.length > 0) {
                // Use average UPH for this work center
                const avgUph = workCenterMatches.reduce((sum: number, e: any) => sum + (e.uph || 0), 0) / workCenterMatches.length;
                uphEntry = { uph: avgUph } as any;
                console.log(`Using average UPH for ${operator.operatorName} - ${workCenter}: ${avgUph} (from ${workCenterMatches.length} other routings)`);
              }
            }
            
            // If still no match, try to find any UPH data for the work center
            if (!uphEntry) {
              const anyWorkCenterMatches = uphResults.filter((entry: any) => 
                entry.workCenter === workCenter
              );
              
              if (anyWorkCenterMatches.length > 0) {
                // Use average UPH for this work center across all operators
                const avgUph = anyWorkCenterMatches.reduce((sum: number, e: any) => sum + (e.uph || 0), 0) / anyWorkCenterMatches.length;
                uphEntry = { uph: avgUph } as any;
                console.log(`Using work center average UPH for ${workCenter}: ${avgUph} (from ${anyWorkCenterMatches.length} records)`);
              }
            }
            
            if (uphEntry && uphEntry.uph > 0) {
              const uphValue = uphEntry.uph;
              estimatedHours = assignment.quantity / uphValue;
              productData.uph = uphValue;
              console.log(`Calculated hours for ${operator.operatorName} - ${workCenter}/${routing}: ${estimatedHours.toFixed(2)}h (${assignment.quantity} units @ ${uphValue} UPH)`);
            } else {
              console.log(`No UPH data found for ${operator.operatorName} - ${workCenter}/${routing}, using 0 hours`);
            }
          }
          
          productData.estimatedHours += estimatedHours;
          operator.totalEstimatedHours += estimatedHours;
          // Store the calculated hours in the assignment data
          assignmentData.estimatedHours = estimatedHours;
        } else {
          // Debug why work order is finished
          console.log(`Skipping finished work order for ${operator.operatorName}: ${routing}`);
        }
        
        // Always add completed hours if available (for both finished and active work orders)
        if (assignment.completedHours && assignment.completedHours > 0) {
          operator.totalCompletedHours += assignment.completedHours;
          if (operator.operatorName === "Evan Crosby") {
            console.log(`Adding completed hours for Evan: ${assignment.completedHours}h for work order ${assignment.workOrderId}`);
          }
        }
      }
    });

    // Convert to array and add calculated fields
    return Array.from(operatorMap.values()).map(operator => {
      const capacityPercent = Math.round((operator.totalEstimatedHours / operator.availableHours) * 100);
      
      // Calculate total observations from UPH data
      let totalObservations = 0;
      if (uphResults && uphResults.length > 0) {
        const operatorUphEntries = uphResults.filter((entry: any) => 
          entry.operatorName === operator.operatorName
        );
        totalObservations = operatorUphEntries.reduce((sum: number, entry: any) => sum + (entry.observationCount || entry.observations || 0), 0);
      }
      
      // Estimate completion date based on workload
      const daysToComplete = Math.ceil(operator.totalEstimatedHours / 8); // 8 hours per day
      const completionDate = new Date();
      completionDate.setDate(completionDate.getDate() + daysToComplete);
      
      return {
        ...operator,
        observations: totalObservations,
        capacityPercent,
        estimatedCompletion: completionDate.toLocaleDateString('en-US', { 
          weekday: 'short', 
          month: 'short', 
          day: 'numeric' 
        }),
        productSummary: Array.from(operator.productSummary.values())
      };
    }).filter(operator => operator.totalAssignments > 0) // Only show operators with assignments
     .sort((a, b) => b.totalAssignments - a.totalAssignments); // Sort by workload
  }, [assignmentsData, operatorsData, uphResults]);



  if (!workloadSummary.length) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center space-x-2 mb-4">
          <Users className="text-blue-600 w-5 h-5" />
          <h2 className="text-lg font-semibold text-gray-900">Operator Workload Summary</h2>
        </div>
        <div className="text-gray-500 text-center py-4">
          No operator assignments found. Assign operators to work orders to see workload summary.
        </div>
      </div>
    );
  }

  // Calculate summary stats
  const totalAssignments = workloadSummary.reduce((sum, op) => sum + op.totalAssignments, 0);
  const totalHours = workloadSummary.reduce((sum, op) => sum + op.totalEstimatedHours, 0);
  const avgCapacity = Math.round(workloadSummary.reduce((sum, op) => sum + op.capacityPercent, 0) / workloadSummary.length);

  return (
    <>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Users className="text-blue-600 w-5 h-5" />
            <h2 className="text-lg font-semibold text-gray-900">Operator Workload Summary</h2>
          </div>
          <div className="flex items-center space-x-6 text-sm">
            <div className="flex items-center space-x-1">
              <span className="font-bold text-blue-600">{totalAssignments}</span>
              <span className="text-gray-600">Total Assignments</span>
            </div>
            <div className="flex items-center space-x-1">
              <span className="font-bold text-green-600">{totalHours.toFixed(0)}h</span>
              <span className="text-gray-600">Total Hours</span>
            </div>
            <div className="flex items-center space-x-1">
              <span className="font-bold text-orange-600">{avgCapacity}%</span>
              <span className="text-gray-600">Avg Capacity</span>
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {workloadSummary.slice(0, 8).map((operator: any) => (
          <div key={operator.operatorId} className="bg-gray-50 rounded-lg p-4 border border-gray-100 relative min-h-[220px]">
            {/* Expand button in top right */}
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2 p-1 h-6 w-6"
              onClick={() => {
                setSelectedOperator(operator);
                setIsModalOpen(true);
              }}
            >
              <Expand className="w-4 h-4" />
            </Button>
            
            {/* Operator Header */}
            <div className="flex items-center space-x-3 mb-3">
              <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold text-sm">
                {operator.operatorName.split(' ').map((n: string) => n[0]).join('').toUpperCase()}
              </div>
              <div>
                <div className="font-medium text-gray-900">{operator.operatorName}</div>
                <div className="text-xs text-gray-500">
                  {isLoadingUph ? (
                    <div className="flex items-center space-x-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Loading...</span>
                    </div>
                  ) : (
                    `${operator.observations} observations`
                  )}
                </div>
              </div>
              <div className="ml-auto text-right pr-6">
                <div className="flex flex-col items-end space-y-1">
                  <div className="flex items-center space-x-2">
                    <div className="text-right">
                      <div className="text-xs text-gray-500">Estimated</div>
                      <div className="text-sm font-bold text-gray-900">
                        {isLoadingUph ? (
                          <div className="flex items-center justify-end space-x-1">
                            <Loader2 className="w-3 h-3 animate-spin" />
                          </div>
                        ) : (
                          `${operator.totalEstimatedHours.toFixed(1)}h`
                        )}
                      </div>
                    </div>
                    {operator.totalCompletedHours > 0 && (
                      <div className="text-right border-l pl-2">
                        <div className="text-xs text-gray-500">Completed</div>
                        <div className="text-sm font-bold text-green-600">
                          {operator.totalCompletedHours.toFixed(1)}h
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">of {operator.availableHours}h available</div>
                </div>
              </div>
            </div>

            {/* Capacity Bar */}
            <div className="mb-3">
              <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                <span>Capacity</span>
                <span>
                  {isLoadingUph ? (
                    <div className="flex items-center space-x-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                    </div>
                  ) : (
                    `${operator.capacityPercent}%`
                  )}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                {isLoadingUph ? (
                  <div className="h-2 rounded-full bg-gray-300 animate-pulse" style={{ width: '30%' }} />
                ) : (
                  <div 
                    className={`h-2 rounded-full ${
                      operator.capacityPercent <= 50 ? 'bg-green-500' :
                      operator.capacityPercent <= 80 ? 'bg-yellow-500' :
                      'bg-red-500'
                    }`}
                    style={{ width: `${Math.min(operator.capacityPercent, 100)}%` }}
                  />
                )}
              </div>
            </div>

            {/* Product Summary */}
            <div className="space-y-1">
              {operator.productSummary && operator.productSummary.slice(0, 3).map((product: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2">
                    <span className="text-gray-700 font-medium">{product.routing}</span>
                    <span className="text-gray-500">({product.workCenter})</span>
                  </div>
                  <div className="flex items-center space-x-2 text-gray-600">
                    <span className="font-medium">{product.totalQuantity} units</span>
                    {product.uph > 0 && (
                      <>
                        <span className="text-gray-400">•</span>
                        <span>{product.uph.toFixed(0)} UPH</span>
                        <span className="text-gray-400">•</span>
                        <span>{product.estimatedHours.toFixed(1)}h</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {operator.productSummary && operator.productSummary.length > 3 && (
                <div className="text-xs text-gray-500 text-center">
                  +{operator.productSummary.length - 3} more products
                </div>
              )}
              <div className="text-xs text-gray-500 pt-1 border-t border-gray-200">
                Est. Completion: {operator.estimatedCompletion}
              </div>
            </div>
          </div>
        ))}
      </div>


      </div>

      {/* Operator Workload Detail Modal */}
      {selectedOperator && (
        <OperatorWorkloadDetailModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedOperator(null);
          }}
          operator={selectedOperator}
        />
      )}
    </>
  );
}