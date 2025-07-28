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
  isEstimated?: boolean;
  estimatedFrom?: string;
  estimatedReason?: string;
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
  debug?: boolean; // For debugging specific combinations
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
  debug,
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
  

  
  // Force component refresh to load new UPH data
  const [refreshKey, setRefreshKey] = useState(0);
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
          setQualifiedOperators(data.operators);
          
          // Debug logging for qualified operators
          console.log(`📊 Operators loaded for ${workCenter}/${routing}:`, {
            count: data.operators.length,
            operators: data.operators.map((op: QualifiedOperator) => ({
              name: op.name,
              uph: op.averageUph,
              isEstimated: op.isEstimated
            }))
          });
          
          if (data.operators.length > 0) {
            const hasEstimated = data.operators.some((op: QualifiedOperator) => op.isEstimated);
            if (hasEstimated) {
              console.log(`⚠️ Estimates showing for ${workCenter}/${routing}:`, {
                totalOperators: data.operators.length,
                estimated: data.operators.filter((op: QualifiedOperator) => op.isEstimated).map((op: QualifiedOperator) => op.name),
                exact: data.operators.filter((op: QualifiedOperator) => !op.isEstimated).map((op: QualifiedOperator) => op.name)
              });
            }
          }
        } else {
          // Debug log to understand why operators aren't loading
          console.error(`❌ Failed to load operators for ${workCenter}/${routing}:`, {
            status: response.status,
            statusText: response.statusText,
            data
          });
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
    
    // Debug logging for hours calculation  
    if (routing === 'Lifetime Collar' && workCenter === 'Cutting' && workOrderIds && workOrderIds.length > 0) {
      console.log(`⏱️ Lifetime Collar Cutting hours calculation:`, {
        quantity,
        operatorUph,
        calculatedHours: hours,
        display: wholeHours === 0 ? `${minutes}m` : minutes === 0 ? `${wholeHours}h` : `${wholeHours}h${minutes}m`,
        workOrderIds: workOrderIds.length
      });
    }
    
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
        value={workOrderIds ? "" : (currentOperatorId?.toString() || "")} 
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
                            {hasAutoAssignment && <Sparkles className="w-3 h-3 text-purple-600" />}
                            <span className="truncate text-green-700">{formatOperatorName(operatorDetails.name)}</span>
                          </div>
                          <div className="flex items-center space-x-1 ml-2">
                            {operatorDetails.observations > 0 && operatorDetails.averageUph > 0 ? (
                              <div className="flex items-center space-x-1">
                                {quantity > 0 && (
                                  <span className={`font-normal ${operatorDetails.isEstimated ? 'text-orange-600' : 'text-green-700'}`}>
                                    {operatorDetails.isEstimated ? '~' : ''}{calculateEstimatedTime(operatorDetails.averageUph)}
                                  </span>
                                )}
                                <span className={`font-normal ${operatorDetails.isEstimated ? 'text-orange-600' : 'text-green-700'}`}>
                                  {operatorDetails.isEstimated ? '~' : ''}{operatorDetails.averageUph.toFixed(1)} UPH
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
                          {hasAutoAssignment && <Sparkles className="w-3 h-3 text-purple-600" />}
                          <span className="text-green-700">{formatOperatorName(operatorName)}</span>
                        </div>
                      );
                    })() : 
                    <span className="text-green-700">{uniqueOperators.length} operators assigned</span>
                ) : ""
              ) : (
                currentOperator ? (
                  <div className="flex items-center justify-between w-full min-w-0">
                    <div className="flex items-center space-x-1">
                      {isCurrentAutoAssigned && <Sparkles className="w-3 h-3 text-purple-600" />}
                      <span className="truncate text-green-700">{formatOperatorName(currentOperator.name)}</span>
                    </div>
                    <div className="flex items-center space-x-1 ml-2">
                      {currentOperator.observations > 0 && currentOperator.averageUph > 0 ? (
                        <div className="flex items-center space-x-1">
                          {quantity > 0 && (
                            <span className={`font-normal ${currentOperator.isEstimated ? 'text-orange-600' : 'text-green-700'}`}>
                              {currentOperator.isEstimated ? '~' : ''}{calculateEstimatedTime(currentOperator.averageUph)}
                            </span>
                          )}
                          <span className={`font-normal ${currentOperator.isEstimated ? 'text-orange-600' : 'text-green-700'}`}>
                            {currentOperator.isEstimated ? '~' : ''}{currentOperator.averageUph.toFixed(1)} UPH
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
                  <span className="text-muted-foreground">
                    {qualifiedOperators.length > 0 ? "Select operator" : "No operators available"}
                  </span>
                )
              )
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {loading && (
            <SelectItem value="loading" disabled>
              <div className="flex items-center justify-between w-full">
                <span className="text-muted-foreground text-xs">
                  Loading operators...
                </span>
              </div>
            </SelectItem>
          )}
          {!loading && qualifiedOperators.length === 0 && (
            <SelectItem value="no-operators" disabled>
              <div className="flex items-center justify-between w-full">
                <span className="text-muted-foreground text-xs">
                  No qualified operators - missing UPH data for {routing}
                </span>
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
            .map(operator => (
              <SelectItem key={operator.id} value={operator.id.toString()}>
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center space-x-1">
                    <span className="truncate">{formatOperatorName(operator.name)}</span>
                    {operator.isEstimated && (
                      <Badge variant="outline" className="text-xs px-1 py-0 bg-orange-50 text-orange-600 border-orange-200">
                        Est
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center space-x-2 ml-2">
                    {operator.observations > 0 && operator.averageUph > 0 ? (
                      <>
                        <span className={`text-xs ${operator.isEstimated ? 'text-orange-600' : 'text-muted-foreground'}`}>
                          {operator.isEstimated ? '~' : ''}{operator.averageUph.toFixed(1)} UPH
                        </span>
                        {quantity > 0 && (
                          <span className={`text-xs ${operator.isEstimated ? 'text-orange-600' : 'text-muted-foreground'}`}>
                            • {operator.isEstimated ? '~' : ''}{calculateEstimatedTime(operator.averageUph)}
                          </span>
                        )}
                      </>
                    ) : (
                      <Badge variant="outline" className="text-xs px-1 py-0">
                        No data
                      </Badge>
                    )}
                  </div>
                </div>
                {operator.isEstimated && operator.estimatedFrom && (
                  <div className="text-xs text-orange-500 mt-1 px-1">
                    Based on {operator.estimatedFrom}
                  </div>
                )}
              </SelectItem>
            ))}
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