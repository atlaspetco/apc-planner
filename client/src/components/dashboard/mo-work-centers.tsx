import { useState } from "react";
import { Plus, Factory, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface WorkOrder {
  id: string;
  work_center: string;
  operation: string;
  quantity_done: number;
  state: string;
}

interface MOWorkCentersProps {
  moNumber: string;
  productName: string;
  quantity: number;
  productCode?: string;
  priority?: string;
  workOrders: WorkOrder[];
  onAddWorkCenter: (workCenter: string) => void;
  onAssignOperator: (workOrderId: string, operatorId: string) => void;
}

const WORK_CENTERS = [
  { value: "cutting", label: "Cutting", color: "bg-blue-500" },
  { value: "sewing", label: "Sewing", color: "bg-green-500" },
  { value: "packaging", label: "Packaging", color: "bg-purple-500" },
  { value: "laser", label: "Laser", color: "bg-red-500" },
  { value: "embroidery", label: "Embroidery", color: "bg-yellow-500" },
  { value: "rope", label: "Rope", color: "bg-orange-500" }
];

const MOCK_OPERATORS = [
  { id: "1", name: "Sally Rudolfs" },
  { id: "2", name: "Courtney Banh" },
  { id: "3", name: "Cris Fuentes" },
  { id: "4", name: "Jon Higgins" }
];

export default function MOWorkCenters({ 
  moNumber, 
  productName, 
  quantity,
  productCode,
  priority, 
  workOrders = [], 
  onAddWorkCenter,
  onAssignOperator 
}: MOWorkCentersProps) {
  const [newWorkCenter, setNewWorkCenter] = useState<string>("");
  
  // Debug log for MO178235
  if (moNumber === "MO178235") {
    console.log(`MO178235 received workOrders:`, workOrders);
  }

  const handleAddWorkCenter = () => {
    if (newWorkCenter) {
      onAddWorkCenter(newWorkCenter);
      setNewWorkCenter("");
    }
  };

  const getWorkCenterColor = (workCenter: string) => {
    const center = WORK_CENTERS.find(wc => wc.value === workCenter.toLowerCase());
    return center?.color || "bg-gray-500";
  };

  const getStateColor = (state: string) => {
    switch (state?.toLowerCase()) {
      case 'done': return 'bg-green-100 text-green-800';
      case 'running': return 'bg-blue-100 text-blue-800';
      case 'waiting': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg font-semibold">{moNumber}</CardTitle>
              {(priority === 'High' || priority === 'Highest') && (
                <Badge variant={priority === 'Highest' ? 'destructive' : 'secondary'} className="text-xs">
                  {priority}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              [Standard.Routing] - [{productCode || 'PROD-CODE'}] | Qty: {quantity}
            </p>
          </div>
          <Factory className="h-5 w-5 text-muted-foreground" />
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Existing Work Orders */}
        {workOrders.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">
              Existing Work Orders ({workOrders.length})
            </h4>
            {workOrders.map((wo) => (
              <div key={wo.id} className="flex items-center justify-between p-3 border rounded-lg bg-blue-50">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${getWorkCenterColor(wo.work_center)}`}></div>
                  <div>
                    <p className="font-medium text-sm">{wo.work_center}</p>
                    <p className="text-xs text-muted-foreground">{wo.operation}</p>
                    <p className="text-xs text-blue-600 font-mono">WO{wo.id}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <Select onValueChange={(operatorId) => onAssignOperator(wo.id, operatorId)}>
                    <SelectTrigger className="w-32 h-8">
                      <SelectValue placeholder="Assign..." />
                    </SelectTrigger>
                    <SelectContent>
                      {MOCK_OPERATORS.map((operator) => (
                        <SelectItem key={operator.id} value={operator.id}>
                          {operator.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  {wo.quantity_done > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      <Clock className="w-3 h-3 mr-1" />
                      {wo.quantity_done} done
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}



        {/* Empty State */}
        {workOrders.length === 0 && (
          <div className="text-center py-6 text-muted-foreground">
            <Factory className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No work orders assigned</p>
            <p className="text-xs">Work orders will appear when available</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}