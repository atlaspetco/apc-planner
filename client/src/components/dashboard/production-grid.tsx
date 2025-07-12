import React, { useState } from 'react';
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ProductionOrder } from "@shared/schema";

interface UphEstimate {
  productionOrderId: number;
  moNumber: string;
  workCenterEstimates: {
    [workCenter: string]: {
      estimatedHours: number;
      operatorName: string | null;
      workOrderIds: number[];
      hasActualData: boolean;
    };
  };
  totalEstimatedHours: number;
}

interface ProductionGridProps {
  productionOrders: ProductionOrder[];
  isLoading: boolean;
}

const WORK_CENTERS = ['Cutting', 'Assembly', 'Packaging'];

// Group orders by routing
const groupOrdersByRouting = (orders: ProductionOrder[]) => {
  const grouped = orders.reduce((acc, order) => {
    const routing = order.routing || 'Unknown Routing';
    if (!acc[routing]) {
      acc[routing] = [];
    }
    acc[routing].push(order);
    return acc;
  }, {} as Record<string, ProductionOrder[]>);
  
  return grouped;
};

// Hook to fetch UPH estimates for multiple production orders
const useUphEstimates = (productionOrderIds: number[]) => {
  return useQuery({
    queryKey: ['/api/production-orders/batch-estimates', productionOrderIds],
    queryFn: () => apiRequest({
      url: '/api/production-orders/batch-estimates',
      method: 'POST',
      body: { productionOrderIds }
    }),
    enabled: productionOrderIds.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

const useQualifiedOperators = (workCenter: string, routing: string) => {
  return useQuery<Array<{operatorId: number, operatorName: string, avgUph: number, observations: number}>>({
    queryKey: ["/api/operators/qualified", workCenter, routing],
    enabled: !!(workCenter && routing),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

// Component for operator dropdown with qualified operators only
const QualifiedOperatorSelect = ({ 
  workCenter, 
  routing, 
  placeholder = "Operator" 
}: { 
  workCenter: string; 
  routing: string; 
  placeholder?: string;
}) => {
  const { data: qualifiedOperators, isLoading } = useQualifiedOperators(workCenter, routing);
  
  if (isLoading) {
    return (
      <Select disabled>
        <SelectTrigger className="w-full h-7 text-xs bg-white border-gray-300">
          <SelectValue placeholder="Loading..." />
        </SelectTrigger>
      </Select>
    );
  }

  if (!qualifiedOperators || qualifiedOperators.length === 0) {
    return (
      <Select disabled>
        <SelectTrigger className="w-full h-7 text-xs bg-gray-100 border-gray-300">
          <SelectValue placeholder="No qualified operators" />
        </SelectTrigger>
      </Select>
    );
  }

  return (
    <Select>
      <SelectTrigger className="w-full h-7 text-xs bg-white border-gray-300">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="unassigned">Unassigned</SelectItem>
        {qualifiedOperators.map((operator) => (
          <SelectItem key={operator.operatorId} value={operator.operatorId.toString()}>
            {operator.operatorName} ({operator.avgUph.toFixed(0)} UPH)
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

// Component to display estimated time under operator assignments
const EstimatedTime = ({ 
  estimate, 
  workCenter, 
  hasOperator
}: { 
  estimate?: UphEstimate; 
  workCenter: string; 
  hasOperator: boolean;
}) => {
  if (!hasOperator || !estimate?.workCenterEstimates[workCenter]) {
    return null;
  }

  const centerEstimate = estimate.workCenterEstimates[workCenter];
  if (centerEstimate.estimatedHours === 0 || !centerEstimate.hasActualData) {
    return null;
  }

  return (
    <div className="text-xs text-green-600 mt-1 font-medium">
      {centerEstimate.estimatedHours.toFixed(1)}h assigned
    </div>
  );
};

export default function ProductionGrid({ productionOrders, isLoading }: ProductionGridProps) {
  console.log('ProductionGrid render:', { isLoading, ordersCount: productionOrders?.length, orders: productionOrders?.slice(0, 2) });
  
  const [expandedRoutings, setExpandedRoutings] = useState<Set<string>>(new Set());
  
  // Get UPH estimates for all production orders
  const productionOrderIds = productionOrders?.map(order => order.id) || [];
  const { data: uphEstimates, isLoading: isLoadingEstimates } = useUphEstimates(productionOrderIds);
  
  // Create a map of estimates by production order ID
  const estimatesMap = new Map<number, UphEstimate>();
  if (uphEstimates && Array.isArray(uphEstimates)) {
    uphEstimates.forEach((estimate: UphEstimate) => {
      estimatesMap.set(estimate.productionOrderId, estimate);
    });
  }
  
  const toggleRouting = (routing: string) => {
    const newExpanded = new Set(expandedRoutings);
    if (newExpanded.has(routing)) {
      newExpanded.delete(routing);
    } else {
      newExpanded.add(routing);
    }
    setExpandedRoutings(newExpanded);
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
              <th className="text-left p-4 font-medium text-gray-900 w-1/3">Routing / Production Order</th>
              <th className="text-center p-2 font-medium text-gray-900 w-16">Qty</th>
              <th className="text-center p-4 font-medium text-gray-900 min-w-[150px]">Cutting</th>
              <th className="text-center p-4 font-medium text-gray-900 min-w-[150px]">Assembly</th>
              <th className="text-center p-4 font-medium text-gray-900 min-w-[150px]">Packaging</th>
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
              const allWorkOrdersByCenter = WORK_CENTERS.reduce((acc, workCenter) => {
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
                            {Object.entries(statusCounts).map(([status, count]) => (
                              <Badge key={status} className={`text-xs ${
                                status === 'assigned' ? 'bg-blue-500 text-white' :
                                status === 'waiting' ? 'bg-blue-400 text-white' :
                                status === 'running' ? 'bg-green-500 text-white' :
                                status === 'done' ? 'bg-gray-500 text-white' :
                                'bg-gray-400 text-white'
                              }`}>
                                {count} {status}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </button>
                    </td>
                    <td className="p-2 text-center w-16">
                      <span className="font-medium text-gray-900">{totalQty}</span>
                    </td>
                    <td className="p-4 text-center">
                      {allWorkOrdersByCenter['Cutting'].length > 0 ? (
                        <span className="text-sm bg-gray-100 px-2 py-1 rounded">
                          {allWorkOrdersByCenter['Cutting'].length} WOs
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="p-4 text-center">
                      {allWorkOrdersByCenter['Assembly'].length > 0 ? (
                        <span className="text-sm bg-gray-100 px-2 py-1 rounded">
                          {allWorkOrdersByCenter['Assembly'].length} WOs
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="p-4 text-center">
                      {allWorkOrdersByCenter['Packaging'].length > 0 ? (
                        <span className="text-sm bg-gray-100 px-2 py-1 rounded">
                          {allWorkOrdersByCenter['Packaging'].length} WOs
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>

                  {/* Individual MO rows (when expanded) */}
                  {isExpanded && orders.map((order) => (
                    <tr key={order.id} className="border-b hover:bg-gray-50">
                      <td className="p-4 pl-12">
                        <div className="font-medium text-gray-900">{order.moNumber}</div>
                        <div className="text-sm text-gray-500">{order.productName || order.moNumber}</div>
                      </td>

                      <td className="p-2 text-center w-16">
                        <span className="font-medium text-gray-900">{order.quantity}</span>
                      </td>
                      <td className="p-4 text-center">
                        {order.workOrders?.filter(wo => wo.workCenter === 'Cutting').length > 0 ? (
                          <div className="flex flex-col items-center">
                            <QualifiedOperatorSelect 
                              workCenter="Cutting" 
                              routing={order.routing || 'Unknown Routing'} 
                              placeholder="Operator" 
                            />
                            <EstimatedTime 
                              estimate={estimatesMap.get(order.id)} 
                              workCenter="Cutting" 
                              hasOperator={true} 
                            />
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        {order.workOrders?.filter(wo => wo.workCenter === 'Assembly').length > 0 ? (
                          <div className="flex flex-col items-center">
                            <QualifiedOperatorSelect 
                              workCenter="Assembly" 
                              routing={order.routing || 'Unknown Routing'} 
                              placeholder="Operator" 
                            />
                            <EstimatedTime 
                              estimate={estimatesMap.get(order.id)} 
                              workCenter="Assembly" 
                              hasOperator={true} 
                            />
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        {order.workOrders?.filter(wo => wo.workCenter === 'Packaging').length > 0 ? (
                          <div className="flex flex-col items-center">
                            <QualifiedOperatorSelect 
                              workCenter="Packaging" 
                              routing={order.routing || 'Unknown Routing'} 
                              placeholder="Operator" 
                            />
                            <EstimatedTime 
                              estimate={estimatesMap.get(order.id)} 
                              workCenter="Packaging" 
                              hasOperator={true} 
                            />
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
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