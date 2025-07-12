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
  workOrderId: number;
  workCenter: string;
  routing: string;
  operation: string;
  quantity: number;
  currentOperatorId?: number | null;
  onAssignmentChange?: (workOrderId: number, operatorId: number | null, estimatedHours: number | null) => void;
}

export function OperatorDropdown({
  workOrderId,
  workCenter,
  routing,
  operation,
  quantity,
  currentOperatorId,
  onAssignmentChange
}: OperatorDropdownProps) {
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
        
        if (data.success) {
          setQualifiedOperators(data.operators);
        } else {
          console.error('Failed to fetch qualified operators:', data.error);
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

  const handleAssignment = async (operatorId: string) => {
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
    <div className="space-y-1">
      <Select 
        value={currentOperatorId?.toString() || "unassigned"} 
        onValueChange={handleAssignment}
        disabled={loading}
      >
        <SelectTrigger className="w-full h-7 text-xs bg-white border-gray-300">
          <SelectValue placeholder={loading ? "Loading..." : "Select Operator"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unassigned">
            <div className="flex items-center justify-between w-full">
              <span>Unassigned</span>
            </div>
          </SelectItem>
          {qualifiedOperators.map(operator => (
            <SelectItem key={operator.id} value={operator.id.toString()}>
              <div className="flex items-center justify-between w-full min-w-0">
                <span className="truncate">{operator.name}</span>
                <div className="flex items-center space-x-1 ml-2">
                  {operator.hasPerformanceData && (
                    <Badge variant="secondary" className="text-xs px-1 py-0">
                      {operator.averageUph.toFixed(1)} UPH
                    </Badge>
                  )}
                  {!operator.hasPerformanceData && (
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
      
      {/* Show operation details */}
      <div className="text-xs text-gray-500">
        {operation} ({workCenter})
      </div>
    </div>
  );
}