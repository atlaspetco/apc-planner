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
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set(["batch-a", "unassigned"]));

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

  const expandAll = () => {
    const allBatches = new Set([
      "batch-a",
      "unassigned",
      ...Array.from(new Set(productionOrders.map(po => po.batchId).filter(Boolean)))
    ]);
    setExpandedBatches(allBatches);
  };

  // Group production orders by batch
  const batchedOrders = productionOrders.reduce((acc, po) => {
    const batchKey = po.batchId || "unassigned";
    if (!acc[batchKey]) {
      acc[batchKey] = [];
    }
    acc[batchKey].push(po);
    return acc;
  }, {} as Record<string, ProductionOrder[]>);

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
            <div className="col-span-2 text-center">Cutting</div>
            <div className="col-span-2 text-center">Assembly</div>
            <div className="col-span-2 text-center">Packaging</div>
            <div className="col-span-1 text-center">Total</div>
          </div>

          {/* Batch Sections */}
          <div>
            {/* Named Batches */}
            {Object.entries(batchedOrders)
              .filter(([batchId]) => batchId !== "unassigned")
              .map(([batchId, orders]) => (
                <BatchSection
                  key={batchId}
                  batchId={batchId}
                  batchName={getBatchName(batchId)}
                  orders={orders}
                  isExpanded={expandedBatches.has(batchId)}
                  onToggle={() => toggleBatch(batchId)}
                  selectedMOs={selectedMOs}
                  onMOSelection={onMOSelection}
                  variant="named"
                />
              ))}

            {/* Unassigned MOs */}
            {batchedOrders.unassigned && (
              <BatchSection
                batchId="unassigned"
                batchName="Unassigned MOs"
                orders={batchedOrders.unassigned}
                isExpanded={expandedBatches.has("unassigned")}
                onToggle={() => toggleBatch("unassigned")}
                selectedMOs={selectedMOs}
                onMOSelection={onMOSelection}
                variant="unassigned"
              />
            )}
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
