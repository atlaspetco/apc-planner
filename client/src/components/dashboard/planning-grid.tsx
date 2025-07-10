import { useState } from "react";
import { Expand, Inbox, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import BatchSection from "./batch-section";
import type { ProductionOrder } from "@shared/schema";

interface PlanningGridProps {
  productionOrders: ProductionOrder[];
  isLoading: boolean;
  selectedMOs: number[];
  onMOSelection: (moIds: number[]) => void;
}

export default function PlanningGrid({ 
  productionOrders, 
  isLoading, 
  selectedMOs, 
  onMOSelection 
}: PlanningGridProps) {
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      onMOSelection(productionOrders.map(po => po.id));
    } else {
      onMOSelection([]);
    }
  };

  const toggleBatch = (batchId: string) => {
    const newExpanded = new Set(expandedBatches);
    if (newExpanded.has(batchId)) {
      newExpanded.delete(batchId);
    } else {
      newExpanded.add(batchId);
    }
    setExpandedBatches(newExpanded);
  };

  // Group production orders by routing using actual routing data from work orders
  const routingGroups = productionOrders.reduce((acc, po) => {
    // Use routing from work orders data (enriched by backend) - never default to "Standard"
    const routing = po.routingName || "Unknown Routing";
    if (!acc[routing]) {
      acc[routing] = [];
    }
    acc[routing].push(po);
    return acc;
  }, {} as Record<string, ProductionOrder[]>);

  const expandAll = () => {
    // Get all routing group keys
    const allRoutingKeys = Object.keys(routingGroups).map(routing => 
      routing.toLowerCase().replace(/\s+/g, '-')
    );
    setExpandedBatches(new Set(allRoutingKeys));
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Production Planning Grid</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      {/* Grid Header */}
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Production Planning Grid</CardTitle>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-500">
              Select MOs to organize into batches
            </span>
            <Button variant="outline" size="sm" onClick={expandAll}>
              <Expand className="w-4 h-4 mr-2" />
              Expand All
            </Button>
          </div>
        </div>
      </CardHeader>

      {/* Table Header */}
      <div className="overflow-x-auto">
        <div className="min-w-full">
          <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-700">
            <div className="col-span-1 flex items-center justify-center">
              <Checkbox
                checked={selectedMOs.length === productionOrders.length && productionOrders.length > 0}
                onCheckedChange={handleSelectAll}
              />
              <span className="ml-1 text-xs">Select</span>
            </div>
            <div className="col-span-2 text-left">Production Order</div>
            <div className="col-span-1 text-center">Status</div>
            <div className="col-span-1 text-center">Qty</div>
            <div className="col-span-2 text-center font-medium">Cutting</div>
            <div className="col-span-2 text-center font-medium">Assembly</div>
            <div className="col-span-2 text-center font-medium">Packaging</div>
            <div className="col-span-1 text-center">Total</div>
          </div>

          {/* Routing Sections */}
          <div>
            {/* All Routing Groups */}
            {Object.entries(routingGroups)
              .sort(([a], [b]) => {
                // Sort "Other" and "Unknown" to the end
                if (a === "Other" || a === "Unknown") return 1;
                if (b === "Other" || b === "Unknown") return -1;
                return a.localeCompare(b);
              })
              .map(([routing, orders]) => (
                <BatchSection
                  key={routing}
                  batchId={routing.toLowerCase().replace(/\s+/g, '-')}
                  batchName={`${routing} (${orders.length} MO${orders.length !== 1 ? 's' : ''})`}
                  orders={orders}
                  isExpanded={expandedBatches.has(routing.toLowerCase().replace(/\s+/g, '-'))}
                  onToggle={() => toggleBatch(routing.toLowerCase().replace(/\s+/g, '-'))}
                  selectedMOs={selectedMOs}
                  onMOSelection={onMOSelection}
                  variant={routing === "Other" || routing === "Unknown" ? "unassigned" : "named"}
                />
              ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function getBatchName(batchId: string): string {
  const batchNames: Record<string, string> = {
    "batch-a": "Batch A - High Priority",
  };
  return batchNames[batchId] || `Batch ${batchId.toUpperCase()}`;
}
