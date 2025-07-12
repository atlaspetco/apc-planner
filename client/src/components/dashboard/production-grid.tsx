import React from 'react';
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProductionOrder } from "@shared/schema";

interface ProductionGridProps {
  productionOrders: ProductionOrder[];
  isLoading: boolean;
}

const WORK_CENTERS = ['Cutting', 'Assembly', 'Packaging'];

export default function ProductionGrid({ productionOrders, isLoading }: ProductionGridProps) {
  console.log('ProductionGrid render:', { isLoading, ordersCount: productionOrders?.length, orders: productionOrders?.slice(0, 2) });
  
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

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          {/* Header */}
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left p-4 font-medium text-gray-900">Production Order</th>
              <th className="text-left p-4 font-medium text-gray-900">Routing</th>
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
            {productionOrders.map((order) => (
              <tr key={order.id} className="border-b hover:bg-gray-50">
                <td className="p-4">
                  <div className="font-medium text-gray-900">{order.moNumber}</div>
                  <div className="text-sm text-gray-500">{order.productName || order.moNumber}</div>
                </td>
                <td className="p-4">
                  <span className="text-sm text-gray-900">{order.routing || 'Unknown Routing'}</span>
                </td>
                <td className="p-4 text-center">
                  <Badge variant={
                    order.status === 'assigned' ? 'default' :
                    order.status === 'running' ? 'secondary' :
                    order.status === 'done' ? 'outline' :
                    'secondary'
                  }>
                    {order.status}
                  </Badge>
                </td>
                <td className="p-4 text-center font-medium">{order.quantity}</td>
                
                {/* Work Center Columns */}
                {WORK_CENTERS.map(workCenter => {
                  const workOrder = order.workOrders?.find(wo => 
                    wo.workCenter?.toLowerCase().includes(workCenter.toLowerCase())
                  );
                  
                  return (
                    <td key={workCenter} className="p-4 text-center">
                      {workOrder ? (
                        <div className="space-y-2">
                          <div className="text-xs text-gray-600">{workOrder.operation}</div>
                          <Select>
                            <SelectTrigger className="w-36 h-8 text-xs">
                              <SelectValue placeholder="Select Operator" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="operator1">Courtney Banh</SelectItem>
                              <SelectItem value="operator2">Devin Cann</SelectItem>
                              <SelectItem value="operator3">Sam Alter</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-sm">No work order</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}