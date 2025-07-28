import React, { useState } from 'react';
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ProductionOrder } from "@shared/schema";
import { OperatorDropdown } from "./operator-dropdown";
import { useToast } from "@/hooks/use-toast";

// Extended type for production orders with embedded work orders
interface WorkOrderData {
  id: number;
  workCenter: string;
  originalWorkCenter: string;
  operation: string;
  state: string;
  quantity: number;
  employee_name: string | null;
  employee_id: number | null;
}

interface ProductionOrderWithWorkOrders extends ProductionOrder {
  workOrders?: WorkOrderData[];
}

interface ProductionGridProps {
  productionOrders: ProductionOrderWithWorkOrders[];
  isLoading: boolean;
  workCenters?: string[];
  assignments?: Map<number, any>;
  onAssignmentChange?: () => void;
}

// Work centers will be loaded dynamically from API
const DEFAULT_WORK_CENTERS = ['Cutting', 'Assembly', 'Packaging'];

// Group orders by routing
const groupOrdersByRouting = (orders: ProductionOrderWithWorkOrders[]) => {
  const grouped = orders.reduce((acc, order) => {
    const routing = order.routing || 'Unknown Routing';
    if (!acc[routing]) {
      acc[routing] = [];
    }
    acc[routing].push(order);
    return acc;
  }, {} as Record<string, ProductionOrderWithWorkOrders[]>);
  
  return grouped;
};

export default function ProductionGrid({ productionOrders, isLoading, workCenters = DEFAULT_WORK_CENTERS, assignments = new Map(), onAssignmentChange }: ProductionGridProps) {
  console.log('ProductionGrid render:', { isLoading, ordersCount: productionOrders?.length, orders: productionOrders?.slice(0, 2) });
  
  const [expandedRoutings, setExpandedRoutings] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  
  const toggleRouting = (routing: string) => {
    const newExpanded = new Set(expandedRoutings);
    if (newExpanded.has(routing)) {
      newExpanded.delete(routing);
    } else {
      newExpanded.add(routing);
    }
    setExpandedRoutings(newExpanded);
  };
  
  const handleOperatorAssign = async (
    workOrderId: number,
    operatorId: number,
    quantity: number,
    routing: string,
    workCenter: string,
    operation: string
  ) => {
    try {
      // API call would go here to assign operator
      console.log('Assigning operator:', {
        workOrderId,
        operatorId,
        quantity,
        routing,
        workCenter,
        operation
      });
      
      toast({
        title: "Operator assigned",
        description: `Successfully assigned operator to work order`,
      });
    } catch (error) {
      console.error('Error assigning operator:', error);
      toast({
        title: "Assignment failed",
        description: "Could not assign operator to work order",
        variant: "destructive",
      });
    }
  };
  
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow">
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading production orders...</p>
        </div>
      </div>
    );
  }

  if (!productionOrders || productionOrders.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow">
        <div className="text-center py-8">
          <p className="text-gray-600">No active production orders found</p>
          <p className="text-sm text-gray-500 mt-2">System is ready for new production orders</p>
        </div>
      </div>
    );
  }

  const groupedOrders = groupOrdersByRouting(productionOrders);

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          {/* Header */}
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left p-4 font-medium text-gray-900">Routing / Production Order</th>
              <th className="text-center p-4 font-medium text-gray-900">Qty</th>
              {workCenters.map(workCenter => (
                <th key={workCenter} className="text-center p-4 font-medium text-gray-900 min-w-[150px]">
                  {workCenter}
                </th>
              ))}
            </tr>
          </thead>

          {/* Body */}
          <tbody>
            {Object.entries(groupedOrders).map(([routing, orders]) => {
              const isExpanded = expandedRoutings.has(routing);
              const totalQty = orders.reduce((sum, order) => sum + order.quantity, 0);
              const statusCounts = orders.reduce((acc, order) => {
                acc[order.status] = (acc[order.status] || 0) + 1;
                return acc;
              }, {} as Record<string, number>);
              
              // Get all work orders for this routing grouped by work center
              const allWorkOrdersByCenter = workCenters.reduce((acc, workCenter) => {
                acc[workCenter] = orders.flatMap(order => 
                  order.workOrders?.filter(wo => wo.workCenter === workCenter) || []
                );
                return acc;
              }, {} as Record<string, any[]>);

              return (
                <React.Fragment key={routing}>
                  {/* Routing header row */}
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <td className="p-4">
                      <button 
                        onClick={() => toggleRouting(routing)}
                        className="flex items-center space-x-2 font-medium text-gray-900 hover:text-gray-700"
                      >
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <div className="flex flex-col items-start">
                          <div className="flex items-center space-x-2">
                            <span>{routing}</span>
                            <span className="text-sm text-blue-600">({orders.length} MOs)</span>
                          </div>
                          <div className="flex space-x-1 mt-1">
                            {Object.entries(statusCounts)
                              .filter(([status]) => status !== 'done' && status !== 'finished')
                              .map(([status, count]) => (
                                <Badge key={status} className={`text-xs rounded-sm ${
                                  status === 'assigned' ? 'bg-blue-500 text-white' :
                                  status === 'waiting' ? 'bg-yellow-500 text-white' :
                                  status === 'running' ? 'bg-green-500 text-white' :
                                  'bg-gray-400 text-white'
                                }`}>
                                  {count} {status}
                                </Badge>
                              ))}
                          </div>
                        </div>
                      </button>
                    </td>
                    <td className="p-4 text-center">
                      <span className="font-medium text-gray-900">{totalQty}</span>
                    </td>
                    {workCenters.map(workCenter => {
                      const workOrdersInCenter = allWorkOrdersByCenter[workCenter];
                      
                      // Calculate total quantity across MOs that have operations in this work center
                      const totalUniqueQuantity = orders.reduce((sum, order) => {
                        const hasWO = order.workOrders?.some(wo => wo.workCenter === workCenter);
                        return hasWO ? sum + (order.quantity || 0) : sum;
                      }, 0);
                      
                      // Debug logging for quantity calculation
                      if (routing === 'Lifetime Collar' && workCenter === 'Cutting') {
                        console.log(`🔍 Lifetime Collar Cutting quantity debug:`, {
                          workOrdersInCenter: workOrdersInCenter.length,
                          totalUniqueQuantity,
                          orders: orders.map(o => ({ moNumber: o.moNumber, quantity: o.quantity }))
                        });
                      }
                      
                      return (
                        <td key={workCenter} className="p-4 text-center">
                          {workOrdersInCenter.length > 0 ? (
                            <div className="space-y-2">
                              <div className="text-xs text-gray-500">
                                {workOrdersInCenter.length} operation{workOrdersInCenter.length > 1 ? 's' : ''}
                              </div>
                              <OperatorDropdown
                                workCenter={workCenter}
                                routing={routing}
                                operation=""
                                quantity={totalUniqueQuantity}
                                workOrderIds={workOrdersInCenter.map(wo => wo.id)}
                                workOrderStates={workOrdersInCenter.map(wo => wo.state)}
                                finishedOperatorNames={workOrdersInCenter.filter(wo => wo.state === 'done').map(wo => wo.employee_name)}
                                assignments={assignments}
                                onAssign={async (operatorId) => {
                                  try {
                                    // Use smart bulk assignment endpoint
                                    const response = await fetch('/api/assignments/smart-bulk', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        routing,
                                        workCenter,
                                        operatorId
                                      })
                                    });
                                    
                                    const result = await response.json();
                                    
                                    if (!response.ok) {
                                      toast({
                                        title: "Assignment Failed",
                                        description: result.error || "Failed to assign operator",
                                        variant: "destructive"
                                      });
                                      return;
                                    }
                                    
                                    // Show success message
                                    toast({
                                      title: "Assignments Updated",
                                      description: result.message,
                                      variant: "default"
                                    });
                                    
                                    // Refresh assignments after bulk assignment
                                    onAssignmentChange?.();
                                  } catch (error) {
                                    console.error("Smart bulk assignment error:", error);
                                    toast({
                                      title: "Error",
                                      description: "Failed to perform bulk assignment",
                                      variant: "destructive"
                                    });
                                  }
                                }}
                                className="w-full"
                              />
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Individual MO rows (when expanded) */}
                  {isExpanded && orders.map((order) => (
                    <tr key={order.id} className="border-b hover:bg-gray-50">
                      <td className="p-4 pl-12">
                        <div className="font-medium text-gray-900">{order.productName || order.moNumber}</div>
                        <div className="flex items-center space-x-2 text-sm text-gray-500">
                          <span>{order.moNumber}</span>
                          <Badge className={`text-xs rounded-sm ${
                            order.status === 'assigned' ? 'bg-blue-500 text-white' :
                            order.status === 'waiting' ? 'bg-yellow-500 text-white' :
                            order.status === 'running' ? 'bg-green-500 text-white' :
                            order.status === 'done' ? 'bg-gray-500 text-white' :
                            'bg-gray-400 text-white'
                          }`}>
                            {order.status}
                          </Badge>
                        </div>
                      </td>
                      <td className="p-4 text-center">
                        <span className="font-medium text-gray-900">{order.quantity}</span>
                      </td>
                      {workCenters.map(workCenter => {
                        const workOrdersInCenter = order.workOrders?.filter(wo => wo.workCenter === workCenter) || [];
                        console.log(`WorkCenter ${workCenter} filtering:`, {
                          allWorkOrders: order.workOrders,
                          filteredWorkOrders: workOrdersInCenter,
                          workCenterMatch: workCenter
                        });
                        return (
                          <td key={workCenter} className="p-4 text-center">
                            {workOrdersInCenter.length > 0 ? (
                              <div className="space-y-2">
                                <div className="text-xs text-gray-500">
                                  {workOrdersInCenter.length} operation{workOrdersInCenter.length > 1 ? 's' : ''}
                                </div>
                                <OperatorDropdown
                                  workCenter={workCenter}
                                  routing={order.routing || ''}
                                  operation=""
                                  quantity={order.quantity}
                                  workOrderIds={workOrdersInCenter.map(wo => wo.id)}
                                  workOrderStates={workOrdersInCenter.map(wo => wo.state)}
                                  finishedOperatorNames={workOrdersInCenter.filter(wo => wo.state === 'done' && wo.employee_name).map(wo => wo.employee_name as string)}
                                  assignments={assignments}
                                  onAssign={async (operatorId) => {
                                    // Bulk assign to all work orders in this work center for this MO
                                    for (const wo of workOrdersInCenter) {
                                      await handleOperatorAssign(wo.id, operatorId, wo.quantity || order.quantity, order.routing || '', workCenter, wo.operation);
                                    }
                                    // Refresh assignments after bulk assignment
                                    onAssignmentChange?.();
                                  }}
                                  className="w-full"
                                />
                              </div>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}