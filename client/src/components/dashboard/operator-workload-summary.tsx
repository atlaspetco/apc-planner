import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, Clock, TrendingUp } from 'lucide-react';

interface OperatorWorkload {
  operatorId: number;
  operatorName: string;
  totalAssignments: number;
  totalEstimatedHours: number;
  availableHours: number;
  capacityPercent: number;
  observations: number;
  estimatedCompletion: string;
}

interface OperatorWorkloadSummaryProps {
  assignments: Map<number, any>;
}

export function OperatorWorkloadSummary({ assignments }: OperatorWorkloadSummaryProps) {
  // Fetch operator data for workload calculations
  const { data: operatorsData } = useQuery({
    queryKey: ["/api/operators"],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Calculate workload summary from assignments
  const workloadSummary = React.useMemo(() => {
    if (!assignments || !operatorsData?.operators) return [];

    const operatorMap = new Map();
    operatorsData.operators.forEach(op => {
      operatorMap.set(op.id, {
        operatorId: op.id,
        operatorName: op.name,
        totalAssignments: 0,
        totalEstimatedHours: 0,
        availableHours: op.availableHours || 40, // Default 40h/week
        observations: op.observations || 0,
        assignments: []
      });
    });

    // Process assignments to calculate workload
    Array.from(assignments.values()).forEach(assignment => {
      const operator = operatorMap.get(assignment.operatorId);
      if (operator) {
        operator.totalAssignments++;
        operator.assignments.push(assignment);
        // Estimate 1 hour per assignment if no specific time data
        operator.totalEstimatedHours += 1; 
      }
    });

    // Convert to array and add calculated fields
    return Array.from(operatorMap.values()).map(operator => {
      const capacityPercent = Math.round((operator.totalEstimatedHours / operator.availableHours) * 100);
      
      // Estimate completion date based on workload
      const daysToComplete = Math.ceil(operator.totalEstimatedHours / 8); // 8 hours per day
      const completionDate = new Date();
      completionDate.setDate(completionDate.getDate() + daysToComplete);
      
      return {
        ...operator,
        capacityPercent,
        estimatedCompletion: completionDate.toLocaleDateString('en-US', { 
          weekday: 'short', 
          month: 'short', 
          day: 'numeric' 
        })
      };
    }).sort((a, b) => b.totalAssignments - a.totalAssignments); // Sort by workload
  }, [assignments, operatorsData]);

  if (!workloadSummary.length) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
      <div className="flex items-center space-x-2 mb-4">
        <Users className="text-blue-600 w-5 h-5" />
        <h2 className="text-lg font-semibold text-gray-900">Operator Workload Summary</h2>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {workloadSummary.slice(0, 6).map((operator) => (
          <div key={operator.operatorId} className="bg-gray-50 rounded-lg p-4 border border-gray-100">
            {/* Operator Header */}
            <div className="flex items-center space-x-3 mb-3">
              <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold text-sm">
                {operator.operatorName.split(' ').map(n => n[0]).join('').toUpperCase()}
              </div>
              <div>
                <div className="font-medium text-gray-900">{operator.operatorName}</div>
                <div className="text-xs text-gray-500">{operator.observations} observations</div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-lg font-bold text-gray-900">{operator.totalEstimatedHours}h</div>
                <div className="text-xs text-gray-500">of {operator.availableHours}h available</div>
              </div>
            </div>

            {/* Capacity Bar */}
            <div className="mb-3">
              <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                <span>Capacity</span>
                <span>{operator.capacityPercent}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className={`h-2 rounded-full ${
                    operator.capacityPercent <= 50 ? 'bg-green-500' :
                    operator.capacityPercent <= 80 ? 'bg-yellow-500' :
                    'bg-red-500'
                  }`}
                  style={{ width: `${Math.min(operator.capacityPercent, 100)}%` }}
                />
              </div>
            </div>

            {/* Assignment Details */}
            <div className="flex items-center justify-between text-sm">
              <div>
                <div className="text-gray-600">Assigned MOs: {operator.totalAssignments}</div>
                <div className="text-gray-500 text-xs">Est. Completion: {operator.estimatedCompletion}</div>
              </div>
              <div className="flex items-center space-x-1">
                <Clock className="w-4 h-4 text-gray-400" />
                <span className="text-xs text-gray-500">
                  {operator.totalEstimatedHours > 0 ? `${operator.totalEstimatedHours}h` : '0h'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Summary Stats */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-blue-600">
              {workloadSummary.reduce((sum, op) => sum + op.totalAssignments, 0)}
            </div>
            <div className="text-sm text-gray-600">Total Assignments</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-600">
              {workloadSummary.reduce((sum, op) => sum + op.totalEstimatedHours, 0)}h
            </div>
            <div className="text-sm text-gray-600">Total Hours</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-orange-600">
              {Math.round(workloadSummary.reduce((sum, op) => sum + op.capacityPercent, 0) / workloadSummary.length)}%
            </div>
            <div className="text-sm text-gray-600">Avg Capacity</div>
          </div>
        </div>
      </div>
    </div>
  );
}