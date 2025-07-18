import React, { useState } from 'react';
import { X, ChevronRight, ChevronDown, Clock, Package } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useQuery } from '@tanstack/react-query';

interface WorkOrderDetail {
  moNumber: string;
  quantity: number;
  estimatedHours: number;
  workCenter: string;
  productRouting: string;
  operation?: string;
  productName?: string;
}

interface OperatorWorkloadDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  operator: {
    operatorId: number;
    operatorName: string;
    totalAssignments: number;
    totalEstimatedHours: number;
    availableHours: number;
    capacityPercent: number;
    estimatedCompletion: string;
    observations: number;
    assignments: any[];
  };
}

export function OperatorWorkloadDetailModal({ 
  isOpen, 
  onClose, 
  operator 
}: OperatorWorkloadDetailModalProps) {
  const [expandedRoutings, setExpandedRoutings] = useState<Set<string>>(new Set());

  // Fetch production orders data to get MO details
  const { data: productionOrdersData } = useQuery({
    queryKey: ["/api/production-orders"],
    enabled: isOpen,
  });

  // Fetch UPH data for accurate time calculations
  const { data: uphData } = useQuery({
    queryKey: ["/api/uph-analytics/table-data"],
    enabled: isOpen,
  });

  // Group assignments by routing
  const assignmentsByRouting = React.useMemo(() => {
    const grouped = new Map<string, WorkOrderDetail[]>();
    
    if (!operator.assignments || !Array.isArray(operator.assignments)) {
      console.warn('No assignments found for operator:', operator);
      return grouped;
    }
    
    operator.assignments.forEach(assignment => {
      console.log('Processing assignment:', assignment);
      const routing = assignment.productRouting || assignment.routing || 'Unknown';
      if (!grouped.has(routing)) {
        grouped.set(routing, []);
      }
      
      // Calculate estimated hours based on UPH data if available
      let estimatedHours = 0; // No fallback
      if (uphData?.uphResults && assignment.quantity > 0) {
        const uphEntry = uphData.uphResults.find((entry: any) => 
          entry.operatorName === operator.operatorName &&
          entry.workCenter === assignment.workCenter &&
          entry.productRouting === routing
        );
        
        if (uphEntry && uphEntry.unitsPerHour > 0) {
          estimatedHours = assignment.quantity / uphEntry.unitsPerHour;
          console.log(`Modal: Found UPH for ${operator.operatorName} - ${assignment.workCenter}/${routing}: ${uphEntry.unitsPerHour} UPH`);
        } else {
          console.log(`Modal: No UPH data for ${operator.operatorName} - ${assignment.workCenter}/${routing}`);
        }
      }
      
      // Use enriched assignment data directly
      grouped.get(routing)!.push({
        moNumber: assignment.moNumber || 'Unknown',
        quantity: assignment.quantity || 0,
        estimatedHours: estimatedHours,
        workCenter: assignment.workCenter || 'Unknown',
        productRouting: routing,
        operation: assignment.operation || 'Unknown',
        productName: assignment.productName || 'Unknown Product'
      });
    });
    
    return grouped;
  }, [operator.assignments, productionOrdersData, uphData]);

  // Calculate total hours per routing
  const routingSummary = Array.from(assignmentsByRouting.entries()).map(([routing, workOrders]) => {
    const totalHours = workOrders.reduce((sum, wo) => sum + wo.estimatedHours, 0);
    const totalQuantity = workOrders.reduce((sum, wo) => sum + wo.quantity, 0);
    const moCount = new Set(workOrders.map(wo => wo.moNumber)).size;
    
    return {
      routing,
      totalHours,
      totalQuantity,
      moCount,
      workOrders
    };
  }).sort((a, b) => b.totalHours - a.totalHours);

  const toggleRouting = (routing: string) => {
    const newExpanded = new Set(expandedRoutings);
    if (newExpanded.has(routing)) {
      newExpanded.delete(routing);
    } else {
      newExpanded.add(routing);
    }
    setExpandedRoutings(newExpanded);
  };

  const handlePushToSlack = async () => {
    try {
      const response = await fetch('/api/slack/send-workload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operatorId: operator.operatorId,
          workloadSummary: {
            operatorName: operator.operatorName,
            totalEstimatedHours: operator.totalEstimatedHours,
            availableHours: operator.availableHours,
            capacityPercent: operator.capacityPercent,
            totalAssignments: operator.totalAssignments,
            routingSummary: routingSummary.map(item => ({
              routing: item.routing,
              moCount: item.moCount,
              totalHours: item.totalHours
            }))
          }
        })
      });

      const result = await response.json();
      
      if (result.success) {
        // Show success message (you could use a toast here)
        alert('Workload summary sent to Slack successfully!');
      } else {
        alert('Failed to send to Slack: ' + result.message);
      }
    } catch (error) {
      console.error('Error sending workload to Slack:', error);
      alert('Error sending workload to Slack');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
                {operator.operatorName.split(' ').map(n => n[0]).join('').toUpperCase()}
              </div>
              <div>
                <h2 className="text-xl font-semibold">{operator.operatorName}</h2>
                <p className="text-sm text-gray-500">{operator.observations} observations</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handlePushToSlack}>
              Push to Slack
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-6">
          {/* Overview Section */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="font-medium text-gray-900 mb-3">Weekly Overview</h3>
            
            {/* Progress Bar */}
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-2">
                <span>Capacity Used</span>
                <span>{operator.capacityPercent}%</span>
              </div>
              <Progress 
                value={Math.min(operator.capacityPercent, 100)} 
                className={`h-3 ${
                  operator.capacityPercent <= 50 ? '[&>div]:bg-green-500' :
                  operator.capacityPercent <= 80 ? '[&>div]:bg-yellow-500' :
                  '[&>div]:bg-red-500'
                }`}
              />
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-gray-900">
                  {operator.totalEstimatedHours.toFixed(1)}h
                </div>
                <div className="text-xs text-gray-500">Total Hours</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">
                  {operator.availableHours}h
                </div>
                <div className="text-xs text-gray-500">Available</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">
                  {operator.totalAssignments}
                </div>
                <div className="text-xs text-gray-500">MOs Assigned</div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Estimated Completion</span>
                <span className="text-sm font-medium text-gray-900">{operator.estimatedCompletion}</span>
              </div>
            </div>
          </div>

          {/* Routing Summary Section */}
          <div>
            <h3 className="font-medium text-gray-900 mb-3">Work by Product Routing</h3>
            <div className="space-y-2">
              {routingSummary.map(({ routing, totalHours, totalQuantity, moCount, workOrders }) => (
                <div key={routing} className="border border-gray-200 rounded-lg">
                  <button
                    onClick={() => toggleRouting(routing)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      {expandedRoutings.has(routing) ? (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                      )}
                      <span className="font-medium text-gray-900">{routing}</span>
                      <Badge variant="secondary" className="text-xs">
                        {moCount} MO{moCount !== 1 ? 's' : ''}
                      </Badge>
                    </div>
                    <div className="flex items-center space-x-4 text-sm">
                      <div className="flex items-center space-x-1">
                        <Package className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-600">{totalQuantity} units</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Clock className="w-4 h-4 text-gray-400" />
                        <span className="font-medium text-gray-900">{totalHours.toFixed(1)}h</span>
                      </div>
                    </div>
                  </button>

                  {expandedRoutings.has(routing) && (
                    <div className="px-4 pb-3 border-t border-gray-100">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-500 text-xs uppercase">
                            <th className="text-left py-2">MO#</th>
                            <th className="text-left py-2">Work Center</th>
                            <th className="text-right py-2">Quantity</th>
                            <th className="text-right py-2">Expected Hours</th>
                          </tr>
                        </thead>
                        <tbody>
                          {workOrders.map((wo, idx) => (
                            <tr key={idx} className="border-t border-gray-50">
                              <td className="py-2 text-gray-900">{wo.moNumber}</td>
                              <td className="py-2 text-gray-600">{wo.workCenter}</td>
                              <td className="py-2 text-right text-gray-900">{wo.quantity}</td>
                              <td className="py-2 text-right font-medium text-gray-900">
                                {wo.estimatedHours.toFixed(1)}h
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}