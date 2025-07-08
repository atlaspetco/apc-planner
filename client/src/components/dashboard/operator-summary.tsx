import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getOperatorInitials, calculateCapacityPercentage, getCapacityColor } from "@/lib/utils";
import type { Operator, WorkOrder } from "@shared/schema";

export default function OperatorSummary() {
  const { data: operators = [], isLoading: isLoadingOperators } = useQuery({
    queryKey: ["/api/operators"],
  });

  const { data: productionOrders = [] } = useQuery({
    queryKey: ["/api/production-orders"],
  });

  if (isLoadingOperators) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Operator Workload Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center">
                    <Skeleton className="w-8 h-8 rounded-full" />
                    <div className="ml-3">
                      <Skeleton className="h-4 w-24 mb-1" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                  <div className="text-right">
                    <Skeleton className="h-4 w-8 mb-1" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
                <Skeleton className="h-2 w-full mb-3" />
                <div className="space-y-1">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Operator Workload Summary</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {operators.map((operator: Operator) => (
            <OperatorCard key={operator.id} operator={operator} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface OperatorCardProps {
  operator: Operator;
}

function OperatorCard({ operator }: OperatorCardProps) {
  const { data: allWorkOrders = [] } = useQuery({
    queryKey: ["/api/work-orders"],
    select: (data) => data.filter((wo: WorkOrder) => wo.assignedOperatorId === operator.id),
  });

  // Calculate scheduled hours
  const scheduledHours = allWorkOrders.reduce((total: number, wo: WorkOrder) => {
    return total + (wo.estimatedHours || 0);
  }, 0);

  const availableHours = operator.availableHours || 40;
  const capacityPercentage = calculateCapacityPercentage(scheduledHours, availableHours);
  const capacityColor = getCapacityColor(capacityPercentage);

  // Get primary work center
  const primaryWorkCenter = operator.workCenters?.[0] || "Unknown";

  // Calculate estimated completion (simplified)
  const estimatedCompletionDate = new Date();
  estimatedCompletionDate.setDate(estimatedCompletionDate.getDate() + Math.ceil(scheduledHours / 8));

  const assignedMOs = new Set(allWorkOrders.map((wo: WorkOrder) => wo.productionOrderId)).size;

  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center">
          <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium">
            {getOperatorInitials(operator.name)}
          </div>
          <div className="ml-3">
            <p className="font-medium text-gray-900">{operator.name}</p>
            <p className="text-sm text-gray-500">{primaryWorkCenter}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-gray-900">
            {Math.round(scheduledHours * 10) / 10}h
          </p>
          <p className="text-xs text-gray-500">of {availableHours}h available</p>
        </div>
      </div>
      
      <div className="mb-3">
        <div className="flex justify-between text-sm mb-1">
          <span>Capacity</span>
          <span>{capacityPercentage}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`${capacityColor} h-2 rounded-full transition-all duration-300`}
            style={{ width: `${Math.min(capacityPercentage, 100)}%` }}
          ></div>
        </div>
      </div>
      
      <div className="text-xs text-gray-600">
        <p>
          Assigned MOs: <span className="font-medium">{assignedMOs}</span>
        </p>
        <p>
          Est. Completion:{" "}
          <span className="font-medium">
            {estimatedCompletionDate.toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </span>
        </p>
      </div>
    </div>
  );
}
