import React, { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';

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

export function OperatorDropdown({
  workOrderId,
  workOrderIds,
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
  
  // For bulk assignments, analyze current assignments
  const bulkAssignmentInfo = workOrderIds && assignments ? 
    workOrderIds.map(woId => {
      const assignment = assignments.get(woId);
      return { workOrderId: woId, assignment };
    }).filter(info => info.assignment) : [];
  
  const assignedOperators = bulkAssignmentInfo.map(info => info.assignment.operatorName).filter(Boolean);
  const uniqueOperators = [...new Set(assignedOperators)];
  
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
          setQualifiedOperators(data.operators);
        } else {
          console.error('Failed to fetch qualified operators:', data.error || 'No operators returned');
          setQualifiedOperators([]);
        }
      } catch (error) {
        console.error('Error fetching qualified operators:', error);
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
      onAssign(parseInt(operatorId));
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

  return (
    <div className={`space-y-1 ${className || ''}`}>
      <Select 
        value={workOrderIds ? (uniqueOperators.length > 0 ? "bulk-assigned" : "unassigned") : (currentOperatorId?.toString() || "unassigned")} 
        onValueChange={handleAssignment}
        disabled={loading}
      >
        <SelectTrigger className="w-full h-8 text-xs bg-white border-gray-300">
          <SelectValue 
            placeholder={
              loading ? "Loading..." : 
              workOrderIds ? (
                uniqueOperators.length > 0 ? 
                  `${uniqueOperators.length === 1 ? uniqueOperators[0] : `${uniqueOperators.length} operators`} assigned` :
                  "Assign operator to all"
              ) : 
              "Select operator"
            }
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unassigned">
            <div className="flex items-center justify-between w-full">
              <span>Unassigned</span>
            </div>
          </SelectItem>
          {workOrderIds && uniqueOperators.length > 0 && (
            <SelectItem value="bulk-assigned" disabled>
              <div className="flex items-center justify-between w-full">
                <span className="text-green-700 font-medium">
                  {uniqueOperators.length === 1 ? 
                    `${uniqueOperators[0]} assigned` : 
                    `${uniqueOperators.length} operators assigned`
                  }
                </span>
              </div>
            </SelectItem>
          )}
          {qualifiedOperators.map(operator => (
            <SelectItem key={operator.id} value={operator.id.toString()}>
              <div className="flex items-center justify-between w-full min-w-0">
                <span className="truncate">{operator.name}</span>
                <div className="flex items-center space-x-1 ml-2">
                  {operator.observations > 0 && operator.averageUph > 0 ? (
                    <div className="flex items-center space-x-1">
                      {quantity > 0 && (
                        <span className="text-sm text-green-700 font-semibold">
                          {calculateEstimatedTime(operator.averageUph)}
                        </span>
                      )}
                      <Badge variant="secondary" className="text-xs px-1 py-0">
                        {operator.averageUph.toFixed(1)} UPH
                      </Badge>
                    </div>
                  ) : (
                    <Badge variant="outline" className="text-xs px-1 py-0">
                      No data
                    </Badge>
                  )}
                </div>
              </div>
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