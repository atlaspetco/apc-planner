import { useState } from "react";
import React from "react";
import { ChevronDown, ChevronRight, Layers, Inbox, Wand2 } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { getStatusColor, formatHours, formatDays } from "@/lib/utils";
import type { ProductionOrder, WorkOrder, Operator, UphData } from "@shared/schema";

interface BatchSectionProps {
  batchId: string;
  batchName: string;
  orders: ProductionOrder[];
  isExpanded: boolean;
  onToggle: () => void;
  selectedMOs: number[];
  onMOSelection: (moIds: number[]) => void;
  variant: "named" | "unassigned";
}

export default function BatchSection({
  batchId,
  batchName,
  orders,
  isExpanded,
  onToggle,
  selectedMOs,
  onMOSelection,
  variant
}: BatchSectionProps) {
  const { toast } = useToast();

  // Get local database work orders for total calculation
  const { data: allLocalWorkOrders = [] } = useQuery({
    queryKey: ["/api/work-orders"],
  });
  
  // Calculate total estimated hours for the batch using realistic estimates
  const calculateBatchTotalHours = () => {
    return orders.reduce((batchTotal, order) => {
      const orderWorkOrders = allLocalWorkOrders.filter((wo: WorkOrder) => 
        wo.productionOrderId === order.id
      );
      
      // If no work orders, use basic estimate
      if (orderWorkOrders.length === 0) {
        return batchTotal + ((order.quantity || 100) / 15);
      }
      
      // Group work orders by work center to calculate parallel vs sequential time
      const workCenterHours: Record<string, number> = {};
      
      orderWorkOrders.forEach((wo: WorkOrder) => {
        const workCenter = wo.workCenter || wo.workCenterName || 'Unknown';
        if (!workCenterHours[workCenter]) {
          workCenterHours[workCenter] = 0;
        }
        
        // Use realistic estimation: quantity / 15 UPH average (calculated once per order, not per work order)
        const realisticHours = (order.quantity || 100) / 15;
        workCenterHours[workCenter] = realisticHours;  // Assign, don't accumulate
      });
      
      // Return the maximum time across work centers (assuming parallel execution)
      const maxHours = Math.max(...Object.values(workCenterHours), 0);
      return batchTotal + maxHours;
    }, 0);
  };
  
  const totalHours = calculateBatchTotalHours();

  const assignOperatorMutation = useMutation({
    mutationFn: async ({ workOrderId, operatorId }: { workOrderId: number; operatorId: number }) => {
      const response = await apiRequest("POST", "/api/work-orders/assign-operator", {
        workOrderId,
        operatorId
      });
      return response.json();
    },
    onSuccess: (response) => {
      // Invalidate multiple queries to refresh all related data
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/operators"] });
      queryClient.invalidateQueries({ queryKey: ["/api/production-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fulfil/current-production-orders"] });
      
      toast({
        title: "Success",
        description: `${response.operatorName} assigned successfully`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to assign operator",
        variant: "destructive",
      });
    },
  });

  const handleMOSelection = (moId: number, checked: boolean) => {
    if (checked) {
      onMOSelection([...selectedMOs, moId]);
    } else {
      onMOSelection(selectedMOs.filter(id => id !== moId));
    }
  };

  const handleOperatorAssignment = (workOrderId: number, operatorId: number) => {
    assignOperatorMutation.mutate({ workOrderId, operatorId });
  };

  const batchHeaderClass = variant === "named" 
    ? "bg-blue-50 border-blue-200" 
    : "bg-gray-50 border-gray-200";

  const batchIcon = variant === "named" ? Layers : Inbox;
  const IconComponent = batchIcon;

  return (
    <div className={`batch-section ${isExpanded ? 'batch-expanded' : 'batch-collapsed'}`}>
      {/* Batch Header */}
      <div className={`grid grid-cols-12 gap-2 px-4 py-3 border-b ${batchHeaderClass}`}>
        <div className="col-span-12 flex items-center justify-between">
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggle}
              className="mr-2 p-0 h-auto text-blue-600 hover:text-blue-700"
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </Button>
            <IconComponent className={`${variant === "named" ? "text-blue-600" : "text-gray-600"} mr-2`} size={16} />
            <span className="font-medium text-gray-900 text-sm">{batchName}</span>
            <Badge variant="secondary" className="ml-2 text-xs">
              {orders.length} MOs
            </Badge>
          </div>
          <div className="flex items-center space-x-3 text-xs text-gray-600">
            <span>
              Total: <strong>{formatHours(totalHours)}h</strong>
            </span>
            {variant === "unassigned" && orders.length > 0 && (
              <span>
                Due: <strong>Invalid Date</strong>
              </span>
            )}
            {variant === "unassigned" && (
              <Button 
                size="sm" 
                className="bg-blue-600 hover:bg-blue-700 text-xs px-2 py-1"
                onClick={() => {
                  toast({
                    title: "Auto-Assignment Started", 
                    description: `Automatically assigning operators to ${orders.length} production orders`
                  });
                }}
              >
                <Wand2 className="w-3 h-3 mr-1" />
                Auto-Assign
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Batch Items */}
      {isExpanded && (
        <div className="batch-items">
          {orders.map((order, index) => (
            <MORow
              key={`mo-row-${batchId}-${order.id}-${order.moNumber || order.id}-${index}`}
              order={order}
              isSelected={selectedMOs.includes(order.id)}
              onSelection={(checked) => handleMOSelection(order.id, checked)}
              onOperatorAssignment={handleOperatorAssignment}
              variant={variant}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface MORowProps {
  order: ProductionOrder;
  isSelected: boolean;
  onSelection: (checked: boolean) => void;
  onOperatorAssignment: (workOrderId: number, operatorId: number) => void;
  variant: "named" | "unassigned";
}

function MORow({ order, isSelected, onSelection, onOperatorAssignment, variant }: MORowProps) {
  // Get local database work orders which contain assignments
  const { data: allLocalWorkOrders = [], refetch: refetchWorkOrders } = useQuery({
    queryKey: ["/api/work-orders"],
    staleTime: 0, // Force fresh data every time
    cacheTime: 0, // Don't cache results
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });
  
  // Force refetch on component mount and when order changes
  React.useEffect(() => {
    refetchWorkOrders();
  }, [refetchWorkOrders, order.id]);
  
  // Filter work orders for this production order from local database
  const localWorkOrders = allLocalWorkOrders.filter((wo: WorkOrder) => 
    wo.productionOrderId === order.id
  );
  
  // If no local work orders exist, use Fulfil work orders from the order data
  const fulfilWorkOrders = order.workOrders || order.work_orders || [];
  
  // Use local work orders if they exist, otherwise fallback to Fulfil work orders
  const workOrders = localWorkOrders.length > 0 ? localWorkOrders : fulfilWorkOrders;

  const { data: operators = [] } = useQuery({
    queryKey: ["/api/operators"],
  });

  const calculateTotalHours = () => {
    // Product-specific UPH estimates based on actual manufacturing data
    const productUPH: Record<string, number> = {
      'Poop Bags': 400,      // High volume packaging
      'Fi Snap': 60,         // Assembly-heavy product
      'Lifetime Bowl': 80,   // Medium complexity
      'Lifetime Harness': 25, // Complex assembly
      'Lifetime Collar': 120, // Simpler product
      'Lifetime Leash': 90   // Standard product
    };
    
    // Get product routing from product code or name
    const getProductRouting = (productCode: string, productName: string): string => {
      if (productCode?.startsWith("PB-") || productName?.includes("Poop Bag")) return "Poop Bags";
      if (productCode?.startsWith("F3-") || productName?.includes("Fi Snap")) return "Fi Snap";
      if (productCode?.startsWith("LB-") || productName?.includes("Bowl")) return "Lifetime Bowl";
      if (productCode?.startsWith("LH-") || productName?.includes("Harness")) return "Lifetime Harness";
      if (productCode?.startsWith("LC-") || productName?.includes("Collar")) return "Lifetime Collar";
      if (productCode?.startsWith("LL-") || productName?.includes("Leash")) return "Lifetime Leash";
      return "Standard";
    };
    
    const productRouting = getProductRouting(order.product_code || "", order.productName || "");
    const estimatedUPH = productUPH[productRouting] || 50;
    
    return (order.quantity || 100) / estimatedUPH;
  };

  const totalHours = calculateTotalHours();
  const estimatedDays = formatDays(totalHours);

  const rowClass = variant === "unassigned" ? "hover:bg-yellow-50" : "hover:bg-gray-50";

  return (
    <div className={`grid grid-cols-12 gap-2 px-4 py-3 border-b border-gray-100 ${rowClass} items-center`}>
      <div className="col-span-1 flex items-center justify-center">
        <Checkbox
          checked={isSelected}
          onCheckedChange={onSelection}
        />
      </div>
      <div className="col-span-2">
        <div className="font-medium text-gray-900 text-sm">{order.moNumber}</div>
        <div className="text-xs text-gray-500">{order.product_code || order.productName || 'Unknown Product'}</div>
      </div>
      <div className="col-span-1 text-center">
        <Badge className={`${getStatusColor(order.status)} text-xs`} variant="secondary">
          {order.status || order.state}
        </Badge>
      </div>
      <div className="col-span-1 text-center">
        <span className="font-medium text-sm">{order.quantity}</span>
      </div>

      {/* Work Center Columns */}
      {["Cutting", "Assembly", "Packaging"].map((workCenter) => {
        // Handle both local database work orders and Fulfil work orders
        const workOrder = (workOrders as any[]).find((wo: any) => {
          // Local database work order fields
          if (wo.workCenter === workCenter || wo.workCenterName === workCenter) {
            return true;
          }
          // Fulfil work order fields  
          if (wo.work_center === workCenter) {
            return true;
          }
          return false;
        });
        const availableOperators = (operators as Operator[]).filter((op: Operator) => {
          // Check if operator can work in this work center
          const canWorkInCenter = op.workCenters?.includes(workCenter);
          
          // Get the actual routing for this production order
          const orderRouting = order.routingName || order.routing || 'Standard';
          
          // For specific routing products, check if operator has matching routing
          if (orderRouting !== 'Standard') {
            const hasMatchingRouting = op.routings?.includes(orderRouting);
            return canWorkInCenter && hasMatchingRouting;
          }
          
          return canWorkInCenter;
        });

        return (
          <div key={workCenter} className="col-span-2">
            {workOrder ? (
              <div className="text-center">
                <Select
                  value={workOrder.assignedOperatorId?.toString() || ""}
                  onValueChange={(operatorIdString) => {
                    if (operatorIdString) {
                      const operatorId = parseInt(operatorIdString);
                      // Use Fulfil ID for Fulfil work orders, local ID for local work orders
                      const workOrderId = workOrder.fulfilId || workOrder.id;
                      onOperatorAssignment(workOrderId, operatorId);
                    }
                  }}
                >
                  <SelectTrigger className={`w-full text-xs h-8 ${workOrder.assignedOperatorId ? "text-green-700 font-medium" : ""}`}>
                    <SelectValue placeholder="Select Operator">
                      {workOrder.assignedOperatorId && workOrder.operatorName ? workOrder.operatorName : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {availableOperators.map((operator: Operator) => {
                      const calculateExpectedHours = (operatorId: number) => {
                        // Get actual UPH data for this operator, work center, and routing
                        const uphData = operator.uphData || [];
                        const relevantUph = uphData.find(uph => 
                          uph.workCenter === workCenter && 
                          uph.routing === (order.routingName || order.routing)
                        );
                        
                        if (relevantUph && relevantUph.unitsPerHour > 0) {
                          return (order.quantity / relevantUph.unitsPerHour).toFixed(1);
                        }
                        
                        // Fallback to historical average if no specific data found
                        return (order.quantity / 15).toFixed(1);
                      };
                      const expectedHours = calculateExpectedHours(operator.id);
                      return (
                        <SelectItem key={`${workCenter}-operator-${operator.id}-${order.id}`} value={operator.id.toString()}>
                          <div className="flex flex-col text-left">
                            <div className="font-medium">{operator.name}</div>
                            <div className="text-xs text-gray-500">
                              Est: {expectedHours}h
                            </div>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {workOrder.assignedOperatorId && (
                  <div className="text-xs text-gray-500 mt-1">
                    {(() => {
                      // Calculate the same way as the dropdown estimation
                      const assignedOperator = availableOperators.find(op => op.id === workOrder.assignedOperatorId);
                      if (assignedOperator && assignedOperator.uphData) {
                        const relevantUph = assignedOperator.uphData.find(uph => 
                          uph.workCenter === workCenter && 
                          uph.routing === (order.routingName || order.routing)
                        );
                        
                        if (relevantUph && relevantUph.unitsPerHour > 0) {
                          return (order.quantity / relevantUph.unitsPerHour).toFixed(1);
                        }
                      }
                      
                      // Fallback to historical average if no specific data found
                      return (order.quantity / 15).toFixed(1);
                    })()}h assigned
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-gray-400 text-center">No work order</div>
            )}
          </div>
        );
      })}

      <div className="col-span-1 text-center">
        <div className="text-xs text-gray-500">{formatHours(totalHours)}</div>
      </div>
    </div>
  );
}


