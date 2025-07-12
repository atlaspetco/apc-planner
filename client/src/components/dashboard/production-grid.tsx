import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      <Card>
        <CardHeader>
          <CardTitle>Production Planning Grid</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading production orders...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!productionOrders || productionOrders.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Production Planning Grid</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-gray-600">No active production orders found</p>
            <p className="text-sm text-gray-500 mt-2">System is ready for new production orders</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Group production orders by routing
  const routingGroups = productionOrders.reduce((acc, po) => {
    const routing = po.routingName || 'Standard';
    if (!acc[routing]) {
      acc[routing] = [];
    }
    acc[routing].push(po);
    return acc;
  }, {} as Record<string, ProductionOrder[]>);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Production Planning Grid</CardTitle>
        <p className="text-sm text-gray-600">
          {productionOrders.length} production orders across {Object.keys(routingGroups).length} routings
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            {/* Header */}
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left p-3 font-medium">Production Order</th>
                <th className="text-left p-3 font-medium">Routing</th>
                <th className="text-center p-3 font-medium">Status</th>
                <th className="text-center p-3 font-medium">Qty</th>
                {WORK_CENTERS.map(wc => (
                  <th key={wc} className="text-center p-3 font-medium">{wc}</th>
                ))}
              </tr>
            </thead>
            
            {/* Body */}
            <tbody>
              {productionOrders
                .sort((a, b) => b.id - a.id) // Sort by ID descending (newest first)
                .map((po) => (
                <tr key={po.id} className="border-b hover:bg-gray-50">
                  <td className="p-3">
                    <div>
                      <div className="font-medium">{po.moNumber}</div>
                      <div className="text-sm text-gray-600">{po.productName}</div>
                    </div>
                  </td>
                  <td className="p-3">
                    <Badge variant="outline">
                      {po.routing || po.routingName || 'Standard'}
                    </Badge>
                  </td>
                  <td className="p-3 text-center">
                    <Badge 
                      variant={
                        po.status === 'running' ? 'default' :
                        po.status === 'draft' ? 'secondary' :
                        po.status === 'request' ? 'destructive' :
                        'outline'
                      }
                    >
                      {po.status}
                    </Badge>
                  </td>
                  <td className="p-3 text-center">{po.quantity}</td>
                  {WORK_CENTERS.map(workCenter => (
                    <td key={workCenter} className="p-3 text-center">
                      <Select>
                        <SelectTrigger className="w-32">
                          <SelectValue placeholder="Assign..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Unassigned</SelectItem>
                          <SelectItem value="operator1">Operator 1</SelectItem>
                          <SelectItem value="operator2">Operator 2</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}