import React, { useState } from 'react';
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ProductionOrder } from "@shared/schema";

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

export default function ProductionGrid({ productionOrders, isLoading }: ProductionGridProps) {
  console.log('ProductionGrid render:', { isLoading, ordersCount: productionOrders?.length, orders: productionOrders?.slice(0, 2) });
  
  const [expandedRoutings, setExpandedRoutings] = useState<Set<string>>(new Set());
  
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
              <th className="text-left p-4 font-medium text-gray-900">Routing / Production Order</th>
              <th className="text-center p-4 font-medium text-gray-900">Status</th>
              <th className="text-center p-4 font-medium text-gray-900">Qty</th>
              {WORK_CENTERS.map(workCenter => (
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
                          <span>{routing}</span>
                          <span className="text-sm text-blue-600">({orders.length} MOs)</span>
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
                    <td className="p-4 text-center">
                      {/* Status column now empty since badges moved to routing name */}
                    </td>
                    <td className="p-4 text-center">
                      <span className="font-medium text-gray-900">{totalQty}</span>
                    </td>
                    {WORK_CENTERS.map(workCenter => {
                      const workOrdersInCenter = allWorkOrdersByCenter[workCenter];
                      return (
                        <td key={workCenter} className="p-4 text-center">
                          {workOrdersInCenter.length > 0 ? (
                            <div className="space-y-1">
                              <Select>
                                <SelectTrigger className="w-full h-8 text-xs bg-gray-100 border-gray-300">
                                  <SelectValue placeholder={`${workCenter}`} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="unassigned">Unassigned</SelectItem>
                                  <SelectItem value="operator1">Courtney Banh</SelectItem>
                                  <SelectItem value="operator2">Devin Cann</SelectItem>
                                  <SelectItem value="operator3">Sam Alter</SelectItem>
                                </SelectContent>
                              </Select>
                              <div className="text-xs text-blue-600">
                                {workOrdersInCenter.length} operations
                              </div>
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
                        <div className="font-medium text-gray-900">{order.moNumber}</div>
                        <div className="text-sm text-gray-500">{order.productName || order.moNumber}</div>
                      </td>
                      <td className="p-4 text-center">
                        <Badge variant={
                          order.status === 'assigned' ? 'default' :
                          order.status === 'running' ? 'secondary' :
                          order.status === 'done' ? 'outline' :
                          'secondary'
                        } className="text-xs">
                          {order.status}
                        </Badge>
                      </td>
                      <td className="p-4 text-center">
                        <span className="font-medium text-gray-900">{order.quantity}</span>
                      </td>
                      {WORK_CENTERS.map(workCenter => {
                        const workOrdersInCenter = order.workOrders?.filter(wo => wo.workCenter === workCenter) || [];
                        return (
                          <td key={workCenter} className="p-4 text-center">
                            {workOrdersInCenter.length > 0 ? (
                              <div className="space-y-1">
                                {workOrdersInCenter.map(workOrder => (
                                  <div key={workOrder.id} className="text-xs">
                                    <Select>
                                      <SelectTrigger className="w-full h-7 text-xs bg-white border-gray-300">
                                        <SelectValue placeholder="Operator" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="unassigned">Unassigned</SelectItem>
                                        <SelectItem value="operator1">Courtney Banh</SelectItem>
                                        <SelectItem value="operator2">Devin Cann</SelectItem>
                                        <SelectItem value="operator3">Sam Alter</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <div className="text-gray-500 mt-1">
                                      {workOrder.operation} ({workOrder.state})
                                    </div>
                                  </div>
                                ))}
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