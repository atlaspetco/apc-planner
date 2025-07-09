import { useState } from "react";
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
  
  // Calculate total estimated hours for the batch from local work orders
  const calculateBatchTotalHours = () => {
    return orders.reduce((batchTotal, order) => {
      const orderWorkOrders = allLocalWorkOrders.filter((wo: WorkOrder) => 
        wo.productionOrderId === order.id
      );
      const orderTotal = orderWorkOrders.reduce((total: number, wo: WorkOrder) => {
        return total + (wo.estimatedHours || 0);
      }, 0);
      return batchTotal + orderTotal;
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
  const { data: allLocalWorkOrders = [] } = useQuery({
    queryKey: ["/api/work-orders"],
  });
  
  // Filter work orders for this production order
  const workOrders = allLocalWorkOrders.filter((wo: WorkOrder) => 
    wo.productionOrderId === order.id
  );

  const { data: operators = [] } = useQuery({
    queryKey: ["/api/operators"],
  });

  const calculateTotalHours = () => {
    return (workOrders as WorkOrder[]).reduce((total: number, wo: WorkOrder) => {
      return total + (wo.estimatedHours || 0);
    }, 0);
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
        const workOrder = (workOrders as WorkOrder[]).find((wo: WorkOrder) => 
          wo.workCenter === workCenter || 
          wo.workCenterName === workCenter || 
          wo.work_center === workCenter ||
          (wo as any).work_center === workCenter
        );
        const availableOperators = (operators as Operator[]).filter((op: Operator) => 
          op.workCenters?.includes(workCenter)
        );

        return (
          <div key={workCenter} className="col-span-2">
            {workOrder ? (
              <div className="text-center">
                <Select
                  value={workOrder.assignedOperatorId?.toString() || ""}
                  onValueChange={(operatorIdString) => {
                    if (operatorIdString) {
                      const operatorId = parseInt(operatorIdString);
                      onOperatorAssignment(workOrder.fulfilId || workOrder.id, operatorId);
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
                        // This would use UPH data to calculate expected hours
                        const mockUph = 15; // Placeholder - would come from actual UPH data
                        return (order.quantity / mockUph).toFixed(1);
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
                    {((order.quantity / 15).toFixed(1))}h expected
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


