import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, User, Users } from "lucide-react";
import OperatorCard from "@/components/operator-settings/operator-card";

interface Operator {
  id: number;
  name: string;
  slackUserId?: string;
  isActive: boolean;
  workCenters: string[];
  operations: string[];
  routings: string[];
  lastActiveDate?: string;
  availableHours?: number;
}

export default function OperatorSettings() {
  const { toast } = useToast();
  const [selectedOperatorId, setSelectedOperatorId] = useState<number | null>(null);

  // Fetch operators
  const { data: operators = [], refetch: refetchOperators, isLoading } = useQuery({
    queryKey: ["/api/operators?activeOnly=false"],
  });

  // Fetch work centers
  const { data: workCenterData = [] } = useQuery({
    queryKey: ["/api/work-centers-operations"],
  });

  // Fetch routings
  const { data: routingsData } = useQuery({
    queryKey: ["/api/routings"],
  });

  // Fetch UPH analytics data for operator capability mapping
  const { data: uphData } = useQuery({
    queryKey: ["/api/uph/table-data"],
  });



  // Helper functions to get operator capabilities from UPH data
  const getOperatorWorkCentersWithData = (operatorName: string): string[] => {
    if (!uphData?.routings) return [];
    
    const workCenters = new Set<string>();
    
    uphData.routings.forEach((routing: any) => {
      const operator = routing.operators?.find((op: any) => op.operatorName === operatorName);
      if (operator?.workCenterPerformance) {
        Object.keys(operator.workCenterPerformance).forEach(wc => {
          if (operator.workCenterPerformance[wc] !== null) {
            workCenters.add(wc);
          }
        });
      }
    });
    
    return Array.from(workCenters);
  };

  const getOperatorRoutingsWithData = (operatorName: string): string[] => {
    if (!uphData?.routings) return [];
    
    return uphData.routings
      .filter((routing: any) => 
        routing.operators?.some((op: any) => op.operatorName === operatorName)
      )
      .map((routing: any) => routing.routingName);
  };

  // Get all available routings
  const getAllAvailableRoutings = (): string[] => {
    if (!routingsData?.routings) return [];
    return routingsData.routings;
  };

  // Get all available operations
  const getAllAvailableOperations = (): string[] => {
    if (!workCenterData) return [];
    const operations = new Set<string>();
    workCenterData.forEach((item: any) => {
      if (item.operations) {
        item.operations.forEach((op: string) => operations.add(op));
      }
    });
    return Array.from(operations);
  };

  // Get all available work centers
  const getAllAvailableWorkCenters = (): string[] => {
    if (!workCenterData) return [];
    return workCenterData.map((item: any) => item.workCenter);
  };

  const getOperatorObservationCount = (operatorName: string): number => {
    if (!uphData?.routings) return 0;
    
    let totalObservations = 0;
    uphData.routings.forEach((routing: any) => {
      const operator = routing.operators?.find((op: any) => op.operatorName === operatorName);
      if (operator?.totalObservations) {
        totalObservations += operator.totalObservations;
      }
    });
    
    return totalObservations;
  };

  const handleRefresh = () => {
    refetchOperators();
    toast({
      title: "Data Refreshed",
      description: "Operator data has been refreshed from the database",
    });
  };

  const getActivityStatus = (operator: Operator) => {
    if (!operator.lastActiveDate) return { status: "inactive", text: "No activity", color: "bg-gray-500" };
    
    const lastActive = new Date(operator.lastActiveDate);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const isRecentlyActive = lastActive > thirtyDaysAgo;
    
    return {
      status: isRecentlyActive ? "active" : "inactive",
      text: isRecentlyActive ? "Recently Active" : "Inactive",
      color: isRecentlyActive ? "bg-green-500" : "bg-gray-500"
    };
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  const selectedOperator = operators.find((op: Operator) => op.id === selectedOperatorId);

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Operator Settings</h1>
          <p className="text-gray-600">Manage operator profiles and work assignments</p>
        </div>
        <Button onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh Data
        </Button>
      </div>

      {/* Operator Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {operators
          .map((operator: Operator) => ({
            ...operator,
            operatorCapabilities: {
              workCenters: getOperatorWorkCentersWithData(operator.name),
              routings: getOperatorRoutingsWithData(operator.name),
              observationCount: getOperatorObservationCount(operator.name),
            }
          }))
          .sort((a, b) => {
            // First sort by active status (active first)
            if (a.isActive !== b.isActive) {
              return a.isActive ? -1 : 1;
            }
            // Within same activity group, sort by observation count (highest first)
            return b.operatorCapabilities.observationCount - a.operatorCapabilities.observationCount;
          })
          .map((operator) => (
            <OperatorCard
              key={operator.id}
              operator={operator}
              availableWorkCenters={getAllAvailableWorkCenters()}
              availableOperations={getAllAvailableOperations()}
              availableRoutings={getAllAvailableRoutings()}
              operatorCapabilities={operator.operatorCapabilities}
            />
          ))}
      </div>
    </div>
  );
}