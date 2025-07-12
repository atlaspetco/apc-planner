import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, User, Users, Grid, List } from "lucide-react";
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
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");

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

  const getOperatorOperationsWithData = (operatorName: string): string[] => {
    if (!uphData?.routings) return [];
    
    const operations = new Set<string>();
    
    // Search through UPH data to find operations this operator has actually performed
    uphData.routings.forEach((routing: any) => {
      const operator = routing.operators?.find((op: any) => op.operatorName === operatorName);
      if (operator?.workCenterPerformance) {
        // UPH data contains operation information in the operation field
        Object.entries(operator.workCenterPerformance).forEach(([workCenter, uphValue]: [string, any]) => {
          if (uphValue !== null && uphValue !== undefined) {
            // If this operator has UPH data for this work center, they can do all operations in that work center
            // Get operations for this work center from workCenterData
            const workCenterInfo = workCenterData?.find((wc: any) => wc.workCenter === workCenter);
            if (workCenterInfo?.operations) {
              workCenterInfo.operations.forEach((op: string) => operations.add(op));
            }
          }
        });
      }
    });
    
    return Array.from(operations);
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



  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  const sortedOperators = operators
    .map((operator: Operator) => ({
      ...operator,
      operatorCapabilities: {
        workCenters: getOperatorWorkCentersWithData(operator.name),
        operations: getOperatorOperationsWithData(operator.name),
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
    });

  const getActivityStatus = (operator: Operator) => {
    if (!operator.lastActiveDate) return { text: "No activity", color: "bg-gray-500" };
    
    const lastActive = new Date(operator.lastActiveDate);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const isRecentlyActive = lastActive > thirtyDaysAgo;
    
    return {
      text: isRecentlyActive ? "Recently Active" : "Inactive",
      color: isRecentlyActive ? "bg-green-500" : "bg-gray-500"
    };
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Operator Settings</h1>
          <p className="text-gray-600">Manage operator profiles and work assignments</p>
        </div>
        <div className="flex items-center space-x-3">
          <div className="flex items-center border rounded-lg p-1">
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("list")}
              className="h-8 px-3"
            >
              <List className="h-4 w-4 mr-1" />
              List
            </Button>
            <Button
              variant={viewMode === "grid" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("grid")}
              className="h-8 px-3"
            >
              <Grid className="h-4 w-4 mr-1" />
              Cards
            </Button>
          </div>
          <Button onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh Data
          </Button>
        </div>
      </div>

      {viewMode === "list" ? (
        /* List View */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Operator List */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Users className="h-5 w-5 mr-2" />
                  Operators ({operators.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {sortedOperators.map((operator) => {
                  const activityStatus = getActivityStatus(operator);
                  return (
                    <div
                      key={operator.id}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedOperatorId === operator.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                      onClick={() => setSelectedOperatorId(operator.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <div className={`w-2 h-2 rounded-full ${activityStatus.color}`}></div>
                          <span className="font-medium text-sm">{operator.name}</span>
                        </div>
                        <Badge variant={operator.isActive ? "default" : "secondary"} className="text-xs">
                          {operator.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {operator.operatorCapabilities.observationCount > 0 
                          ? `${operator.operatorCapabilities.observationCount} observations` 
                          : activityStatus.text}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          {/* Operator Details */}
          <div className="lg:col-span-2">
            {selectedOperatorId ? (
              (() => {
                const selectedOperator = sortedOperators.find(op => op.id === selectedOperatorId);
                return selectedOperator ? (
                  <OperatorCard
                    operator={selectedOperator}
                    availableWorkCenters={getAllAvailableWorkCenters()}
                    availableOperations={getAllAvailableOperations()}
                    availableRoutings={getAllAvailableRoutings()}
                    operatorCapabilities={selectedOperator.operatorCapabilities}
                  />
                ) : (
                  <Card>
                    <CardContent className="flex items-center justify-center h-64">
                      <div className="text-center">
                        <User className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-600">Operator not found</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })()
            ) : (
              <Card>
                <CardContent className="flex items-center justify-center h-64">
                  <div className="text-center">
                    <User className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600">Select an operator to view and edit settings</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      ) : (
        /* Grid View */
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {sortedOperators.map((operator) => (
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
      )}
    </div>
  );
}