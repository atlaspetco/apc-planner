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

  // Helper function to extract routing from product code
  const getRoutingFromProductCode = (productCode: string): string => {
    if (!productCode) return "Unknown";
    
    // Extract routing patterns based on product codes with actual product names
    if (productCode.startsWith("LP-")) return "Lifetime Pouch";
    if (productCode.startsWith("F3-")) return "Fi Snap";
    if (productCode.startsWith("LHP-")) return "Lifetime Pro Harness";  // LHP-LG is Lifetime Pro Harness
    if (productCode.startsWith("PB-")) return "Poop Bags";
    if (productCode.startsWith("LB-")) return "Lifetime Bowl";
    if (productCode.startsWith("LC-")) return "Lifetime Collar";
    if (productCode.startsWith("LL-")) return "Lifetime Leash";
    if (productCode.startsWith("LH-")) return "Lifetime Harness";
    if (productCode.startsWith("LS-")) return "Lifetime Slip";
    
    return "Other";
  };

  // Group production orders by routing instead of batch
  const routingGroups = productionOrders.reduce((acc, po) => {
    const routing = getRoutingFromProductCode(po.product_code || po.productName || "");
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
    <Card className="mb-6 planning-grid">
      {/* Grid Header */}
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg md:text-xl">Production Planning Grid</CardTitle>
          <div className="flex items-center space-x-2 md:space-x-4">
            <span className="hidden md:block text-sm text-gray-500">
              Select MOs to organize into batches
            </span>
            <Button variant="outline" size="sm" onClick={expandAll}>
              <Expand className="w-4 h-4 md:mr-2" />
              <span className="hidden md:inline">Expand All</span>
            </Button>
          </div>
        </div>
      </CardHeader>

      {/* Table Header */}
      <div className="overflow-x-auto">
        <div className="min-w-full">
          {/* Desktop/iPad Header (md+) */}
          <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-4 bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-700 items-center">
            <div className="col-span-1 flex items-center justify-center">
              <Checkbox
                checked={selectedMOs.length === productionOrders.length && productionOrders.length > 0}
                onCheckedChange={handleSelectAll}
              />
            </div>
            <div className="col-span-3 text-left">Production Order</div>
            <div className="col-span-1 text-center">Status</div>
            <div className="col-span-1 text-center">Qty</div>
            <div className="col-span-2 text-center">Cutting</div>
            <div className="col-span-2 text-center">Assembly</div>
            <div className="col-span-2 text-center">Packaging</div>
          </div>
          
          {/* Mobile Header (sm and below) */}
          <div className="md:hidden grid grid-cols-8 gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-700 items-center">
            <div className="col-span-1 flex items-center justify-center">
              <Checkbox
                checked={selectedMOs.length === productionOrders.length && productionOrders.length > 0}
                onCheckedChange={handleSelectAll}
              />
            </div>
            <div className="col-span-2 text-left">MO</div>
            <div className="col-span-1 text-center">Qty</div>
            <div className="col-span-1 text-center">Cut</div>
            <div className="col-span-1 text-center">Asm</div>
            <div className="col-span-2 text-center">Pack</div>
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
