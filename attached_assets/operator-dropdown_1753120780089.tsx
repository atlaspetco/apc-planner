import React, { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Sparkles } from 'lucide-react';

interface QualifiedOperator {
  id: number;
  name: string;
  availableHours: number;
  averageUph: number;
  observations: number;
  hasPerformanceData: boolean;
}

interface OperatorDropdownProps {
  workOrderId?: number; // Optional for backward compatibility
  workOrderIds?: number[]; // For bulk assignment
  workOrderStates?: string[]; // States of work orders
  finishedOperatorNames?: string[]; // Names of operators who finished work orders
  workCenter: string;
  routing: string;
  operation: string;
  quantity: number;
  currentOperatorId?: number | null;
  currentOperatorName?: string;
  assignments?: Map<number, any>; // For bulk assignment display
  onAssignmentChange?: (workOrderId: number, operatorId: number | null, estimatedHours: number | null) => void;
  onAssign?: (operatorId: number) => void; // For bulk assignment
  className?: string;
}

// Helper function to format operator name as "First L."
function formatOperatorName(fullName: string): string {
  const parts = fullName.trim().split(' ');
  if (parts.length < 2) return fullName;
  const firstName = parts[0];
  const lastInitial = parts[parts.length - 1][0];
  return `${firstName} ${lastInitial}.`;
}

export function OperatorDropdown({
  workOrderId,
  workOrderIds,
  workOrderStates,
  finishedOperatorNames,
  workCenter,
  routing,
  operation,
  quantity,
  currentOperatorId,
  currentOperatorName,
  assignments,
  onAssignmentChange,
  onAssign,
  className
}: OperatorDropdownProps) {
  
  // Check if all work orders are finished
  const allFinished = workOrderStates && workOrderStates.length > 0 && 
    workOrderStates.every(state => state === 'done' || state === 'finished');
  
  // Get unique finished operator names
  const uniqueFinishedOperators = finishedOperatorNames ? 
    [...new Set(finishedOperatorNames.filter(Boolean))] : [];
  
  // For bulk assignments, analyze current assignments
  const bulkAssignmentInfo = workOrderIds && assignments ? 
    workOrderIds.map((woId, index) => {
      const assignment = assignments.get(woId);
      const isFinished = workOrderStates?.[index] === 'done' || workOrderStates?.[index] === 'finished';
      const finishedOperator = finishedOperatorNames?.[index];
      return { workOrderId: woId, assignment, isFinished, finishedOperator };
    }).filter(info => info.assignment || info.isFinished) : [];
  
  const assignedOperators = bulkAssignmentInfo
    .map(info => info.finishedOperator || info.assignment?.operatorName)
    .filter(Boolean);
  const uniqueOperators = [...new Set(assignedOperators)];
  
  // Check if any assignments are auto-assigned
  const hasAutoAssignment = bulkAssignmentInfo.some(info => info.assignment?.isAutoAssigned);
  
  // Debug logging  
  if (uniqueOperators.length > 0) {
    console.log(`✅ BULK ASSIGNMENT DETECTED for ${workCenter}:`, {
      workOrderIds,
      assignedOperators: uniqueOperators,
      displayText: uniqueOperators.length === 1 ? `${uniqueOperators[0]} assigned` : `${uniqueOperators.length} operators assigned`
    });
  }
  const [qualifiedOperators, setQualifiedOperators] = useState<QualifiedOperator[]>([]);
  const [loading, setLoading] = useState(false);
  const [estimatedHours, setEstimatedHours] = useState<number | null>(null);
  const { toast } = useToast();

  // Fetch qualified operators when component mounts or work center/routing changes
  useEffect(() => {
    const fetchQualifiedOperators = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams({
          workCenter,
          ...(routing && { routing }),
          ...(operation && { operation })
        });
        
        const response = await fetch(`/api/operators/qualified?${params}`);
        const data = await response.json();
        
        if (response.ok && data.operators) {
          // Enhanced filtering: Only show operators with existing UPH data for this specific combination
          const strictlyQualifiedOperators = data.operators.filter((op: any) => {
            // Must have meaningful UPH data for this combination
            const hasValidUphData = op.averageUph > 0 && op.observations > 0;
            
            // Must have work center enabled in settings
            const hasWorkCenterEnabled = op.workCenters?.includes(workCenter) || 
              (workCenter === 'Assembly' && (op.workCenters?.includes('Sewing') || op.workCenters?.includes('Rope') || op.workCenters?.includes('Assembly')));
            
            // Must have routing enabled (if routing constraints exist)
            const hasRoutingEnabled = !op.routings?.length || op.routings.includes(routing);
            
            // Log filtering decision for debugging
            if (!hasValidUphData) {
              console.log(`❌ ${op.name}: No UPH data (UPH: ${op.averageUph}, Obs: ${op.observations}) for ${routing}/${workCenter}`);
            } else if (!hasWorkCenterEnabled) {
              console.log(`❌ ${op.name}: Work center not enabled for ${workCenter} (has: ${op.workCenters?.join(', ')})`);
            } else if (!hasRoutingEnabled) {
              console.log(`❌ ${op.name}: Routing not enabled for ${routing} (has: ${op.routings?.join(', ')})`);
            } else {
              console.log(`✅ ${op.name}: Qualified for ${routing}/${workCenter} (${op.averageUph.toFixed(1)} UPH, ${op.observations} obs)`);
            }
            
            return hasValidUphData && hasWorkCenterEnabled && hasRoutingEnabled;
          });
          
          console.log(`Filtered ${data.operators.length} operators to ${strictlyQualifiedOperators.length} with UPH data for ${routing}/${workCenter}`);
          setQualifiedOperators(strictlyQualifiedOperators);
        } else {
          // Don't log errors for normal operation, just handle gracefully
          setQualifiedOperators([]);
        }
      } catch (error) {
        console.error('Error fetching qualified operators:', error);
        // Don't show error toast for every dropdown, just log it
        setQualifiedOperators([]);
      } finally {
        setLoading(false);
      }
    };

    if (workCenter && routing) {
      fetchQualifiedOperators();
    }
  }, [workCenter, routing, operation]);

  // Calculate estimated time based on quantity and operator UPH
  const calculateEstimatedTime = (operatorUph: number): string => {
    if (!quantity || operatorUph <= 0) return "No estimate";
    
    const hours = quantity / operatorUph;
    const wholeHours = Math.floor(hours);
    const minutes = Math.round((hours - wholeHours) * 60);
    
    if (wholeHours === 0) {
      return `${minutes}m`;
    } else if (minutes === 0) {
      return `${wholeHours}h`;
    } else {
      return `${wholeHours}h${minutes}m`;
    }
  };

  const handleAssignment = async (operatorId: string) => {
    if (onAssign) {
      // For bulk assignment, use the onAssign callback
      if (operatorId === "unassigned") {
        onAssign(0); // Use 0 to indicate unassignment
      } else {
        onAssign(parseInt(operatorId));
      }
      return;
    }

    // For single work order assignment
    if (!workOrderId) return;
    
    try {
      const response = await fetch('/api/work-orders/assign-operator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workOrderId,
          operatorId: operatorId === "unassigned" ? null : operatorId,
          quantity,
          routing,
          workCenter,
          operation
        })
      });

      const result = await response.json();
      
      if (result.success) {
        setEstimatedHours(result.estimatedHours);
        onAssignmentChange?.(workOrderId, result.operatorId, result.estimatedHours);
        
        toast({
          title: "Assignment Updated",
          description: result.message,
          duration: 3000
        });
      } else {
        toast({
          title: "Assignment Failed",
          description: result.error || "Failed to assign operator",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Assignment error:', error);
      toast({
        title: "Assignment Error",
        description: "Network error occurred",
        variant: "destructive"
      });
    }
  };

  // Find current operator name
  const currentOperator = currentOperatorId 
    ? qualifiedOperators.find(op => op.id === currentOperatorId)
    : null;
    
  // For single work order, check if it's auto-assigned
  const currentAssignment = workOrderId && assignments ? assignments.get(workOrderId) : null;
  const isCurrentAutoAssigned = currentAssignment?.isAutoAssigned || false;
  
  // Determine assignment color based on type
  const getAssignmentColor = (assignment: any, isFinished: boolean) => {
    if (isFinished) {
      return "text-gray-700"; // Actual/Completed assignments (locked)
    } else if (assignment?.isAutoAssigned) {
      return "text-blue-600 font-medium"; // Auto-Assignment (AI) - Blue
    } else if (assignment) {
      return "text-green-600 font-medium"; // Manual Assignment - Green
    }
    return "text-gray-500"; // Unassigned
  };

  // Calculate operator capacity and constraints
  const getOperatorCapacity = (operatorId: number) => {
    const operator = qualifiedOperators.find(op => op.id === operatorId);
    if (!operator) return { canAssign: false, reason: "Operator not found" };

    const availableHours = operator.availableHours || 40;
    const schedulePercentage = operator.schedulePercentage || 90;
    const maxSchedulableHours = (availableHours * schedulePercentage) / 100;
    
    // Calculate current assigned hours for this operator
    let currentAssignedHours = 0;
    if (assignments) {
      Array.from(assignments.values()).forEach(assignment => {
        if (assignment.operatorId === operatorId && assignment.workOrderState !== 'finished') {
          // Estimate hours based on quantity and UPH
          const estimatedHours = assignment.estimatedHours || 
            (assignment.quantity && operator.averageUph ? assignment.quantity / operator.averageUph : 1);
          currentAssignedHours += estimatedHours;
        }
      });
    }

    // Calculate hours needed for this assignment
    const estimatedHoursNeeded = quantity && operator.averageUph > 0 
      ? quantity / operator.averageUph 
      : 1; // Default 1 hour if no UPH data

    const totalHoursAfterAssignment = currentAssignedHours + estimatedHoursNeeded;
    const remainingHours = maxSchedulableHours - currentAssignedHours;
    const utilizationPercentage = (totalHoursAfterAssignment / maxSchedulableHours) * 100;

    return {
      canAssign: totalHoursAfterAssignment <= maxSchedulableHours,
      currentAssignedHours,
      maxSchedulableHours,
      remainingHours,
      estimatedHoursNeeded,
      utilizationPercentage,
      reason: totalHoursAfterAssignment > maxSchedulableHours 
        ? `Would exceed capacity (${utilizationPercentage.toFixed(0)}% utilization)` 
        : `Available (${utilizationPercentage.toFixed(0)}% utilization)`
    };
  };

  // If all work orders are finished, show the finished operators
  if (allFinished && uniqueFinishedOperators.length > 0) {
    return (
      <div className={`space-y-1 ${className || ''}`}>
        <div className="w-full h-8 text-xs bg-gray-100 border border-gray-300 rounded px-2 py-1 flex items-center justify-between cursor-not-allowed">
          <span className="text-gray-700">
            {uniqueFinishedOperators.length === 1 
              ? uniqueFinishedOperators[0]
              : `${uniqueFinishedOperators.length} operators finished`}
          </span>
          <Badge variant="outline" className="text-xs px-1 py-0 bg-gray-50">
            Finished
          </Badge>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-1 ${className || ''}`}>
      <Select 
        value={workOrderIds ? (uniqueOperators.length > 0 ? "bulk-assigned" : "") : (currentOperatorId?.toString() || "")} 
        onValueChange={handleAssignment}
        disabled={loading || allFinished}
      >
        <SelectTrigger className={`w-full h-8 text-xs ${allFinished ? 'bg-gray-100' : 'bg-white'} border-gray-300`}>
          <SelectValue>
            {loading ? "Loading..." : 
              workOrderIds ? (
                uniqueOperators.length > 0 ? (
                  uniqueOperators.length === 1 ? 
                    (() => {
                      // Find the operator details for single bulk assignment
                      const operatorName = uniqueOperators[0];
                      const operatorDetails = qualifiedOperators.find(op => op.name === operatorName);
                      return operatorDetails ? (
                        <div className="flex items-center justify-between w-full min-w-0">
                          <div className="flex items-center space-x-1">
                            {hasAutoAssignment && <Sparkles className="w-3 h-3 text-blue-500" />}
                            <span className={`truncate ${getAssignmentColor(bulkAssignmentInfo[0]?.assignment, bulkAssignmentInfo[0]?.isFinished)}`}>
                              {formatOperatorName(operatorDetails.name)}
                            </span>
                            {hasAutoAssignment && (
                              <Badge variant="outline" className="text-xs px-1 py-0 text-blue-600 border-blue-200">
                                AI
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center space-x-1 ml-2">
                            {operatorDetails.observations > 0 && operatorDetails.averageUph > 0 ? (
                              <div className="flex items-center space-x-1">
                                {quantity > 0 && (
                                  <span className="text-green-700 font-normal">
                                    {calculateEstimatedTime(operatorDetails.averageUph)}
                                  </span>
                                )}
                                <span className="text-green-700 font-normal">
                                  {operatorDetails.averageUph.toFixed(1)} UPH
                                </span>
                              </div>
                            ) : (
                              <Badge variant="outline" className="text-xs px-1 py-0">
                                No data
                              </Badge>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-1">
                          {hasAutoAssignment && <Sparkles className="w-3 h-3 text-blue-500" />}
                          <span className={getAssignmentColor(bulkAssignmentInfo[0]?.assignment, bulkAssignmentInfo[0]?.isFinished)}>
                            {formatOperatorName(operatorName)}
                          </span>
                          {hasAutoAssignment && (
                            <Badge variant="outline" className="text-xs px-1 py-0 text-blue-600 border-blue-200">
                              AI
                            </Badge>
                          )}
                        </div>
                      );
                    })() : 
                    <div className="flex items-center space-x-1">
                      <span className="text-gray-600">{uniqueOperators.length} operators assigned</span>
                      {hasAutoAssignment && (
                        <Badge variant="outline" className="text-xs px-1 py-0 text-blue-600 border-blue-200">
                          AI
                        </Badge>
                      )}
                    </div>
                ) : ""
              ) : (
                currentOperator ? (
                  <div className="flex items-center justify-between w-full min-w-0">
                    <div className="flex items-center space-x-1">
                      {isCurrentAutoAssigned && <Sparkles className="w-3 h-3 text-blue-500" />}
                      <span className={`truncate ${getAssignmentColor(currentAssignment, false)}`}>
                        {formatOperatorName(currentOperator.name)}
                      </span>
                      {isCurrentAutoAssigned && (
                        <Badge variant="outline" className="text-xs px-1 py-0 text-blue-600 border-blue-200">
                          AI
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center space-x-1 ml-2">
                      {currentOperator.observations > 0 && currentOperator.averageUph > 0 ? (
                        <div className="flex items-center space-x-1">
                          {quantity > 0 && (
                            <span className="text-green-700 font-normal">
                              {calculateEstimatedTime(currentOperator.averageUph)}
                            </span>
                          )}
                          <span className="text-green-700 font-normal">
                            {currentOperator.averageUph.toFixed(1)} UPH
                          </span>
                        </div>
                      ) : (
                        <Badge variant="outline" className="text-xs px-1 py-0">
                          No data
                        </Badge>
                      )}
                    </div>
                  </div>
                ) : ""
              )
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {qualifiedOperators.length === 0 && !loading && (
            <SelectItem value="no-operators" disabled>
              <div className="flex flex-col w-full py-2">
                <div className="flex items-center space-x-2 text-red-600">
                  <span className="text-xs">⚠️ No Qualified Operators</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Missing UPH data for {routing} / {workCenter}
                </div>
                <div className="text-xs text-blue-600 mt-1">
                  💡 Operators need historical performance data to be assignable
                </div>
              </div>
            </SelectItem>
          )}
          {loading && (
            <SelectItem value="loading" disabled>
              <div className="flex items-center space-x-2">
                <div className="animate-spin h-3 w-3 border border-gray-300 border-t-blue-600 rounded-full"></div>
                <span className="text-xs text-muted-foreground">Loading qualified operators...</span>
              </div>
            </SelectItem>
          )}
          {workOrderIds && uniqueOperators.length > 0 && (
            <SelectItem value="bulk-assigned" disabled>
              <div className="flex items-center justify-between w-full">
                <span className="text-green-700 font-medium">
                  {uniqueOperators.length === 1 ? 
                    formatOperatorName(uniqueOperators[0]) : 
                    `${uniqueOperators.length} operators assigned`
                  }
                </span>
              </div>
            </SelectItem>
          )}
          {qualifiedOperators
            .filter(operator => {
              // Don't show the current operator in dropdown list to avoid duplication
              return workOrderIds ? 
                !uniqueOperators.includes(operator.name) : 
                currentOperatorId !== operator.id;
            })
            .map(operator => {
              const capacity = getOperatorCapacity(operator.id);
              return (
                <SelectItem 
                  key={operator.id} 
                  value={operator.id.toString()}
                  disabled={!capacity.canAssign}
                  className={!capacity.canAssign ? "opacity-50" : ""}
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="truncate">{formatOperatorName(operator.name)}</span>
                      {!capacity.canAssign && (
                        <span className="text-xs text-red-600 truncate">
                          {capacity.reason}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-2 ml-2">
                      {operator.observations > 0 && operator.averageUph > 0 ? (
                        <>
                          <span className="text-xs text-muted-foreground">
                            {operator.averageUph.toFixed(1)} UPH
                          </span>
                          {quantity > 0 && (
                            <span className="text-xs text-muted-foreground">
                              • {calculateEstimatedTime(operator.averageUph)}
                            </span>
                          )}
                        </>
                      ) : (
                        <Badge variant="outline" className="text-xs px-1 py-0">
                          No data
                        </Badge>
                      )}
                      {/* Capacity indicator */}
                      <div className={`w-2 h-2 rounded-full ${
                        capacity.utilizationPercentage >= 95 ? 'bg-red-500' :
                        capacity.utilizationPercentage >= 80 ? 'bg-yellow-500' :
                        'bg-green-500'
                      }`} title={`${capacity.utilizationPercentage.toFixed(0)}% utilization`}></div>
                    </div>
                  </div>
                </SelectItem>
              );
            })}
        </SelectContent>
      </Select>
      
      {/* Show estimated time when operator is selected */}
      {estimatedHours !== null && (
        <div className="text-xs text-green-600 font-medium">
          ~{estimatedHours}h ({Math.round(quantity / estimatedHours)} UPH)
        </div>
      )}
    </div>
  );
}