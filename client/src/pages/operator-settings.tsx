import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, User, Activity, Clock } from "lucide-react";

interface Operator {
  id: number;
  name: string;
  slackUserId?: string;
  isActive: boolean;
  workCenters: string[];
  operations: string[];
  productRoutings: string[];
  lastActiveDate?: string;
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

  const updateOperatorMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Partial<Operator> }) => {
      const response = await apiRequest("PATCH", `/api/operators/${id}`, updates);
      return response.json();
    },
    onSuccess: () => {
      refetchOperators();
      toast({
        title: "Success",
        description: "Operator settings updated successfully",
      });
    },
    onError: (error) => {
      console.error("Update error:", error);
      toast({
        title: "Error",
        description: "Failed to update operator settings",
        variant: "destructive",
      });
    },
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

  const handleOperatorUpdate = (operatorId: number, field: string, value: any) => {
    const updates = { [field]: value };
    updateOperatorMutation.mutate({ id: operatorId, updates });
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
        <Button onClick={handleRefresh} disabled={updateOperatorMutation.isPending}>
          <RefreshCw className={`h-4 w-4 mr-2 ${updateOperatorMutation.isPending ? 'animate-spin' : ''}`} />
          Refresh Data
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Operator List */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <User className="h-5 w-5 mr-2" />
                Operators ({operators.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {operators
                .map((operator: Operator) => ({
                  ...operator,
                  observationCount: getOperatorObservationCount(operator.name),
                  activityStatus: getActivityStatus(operator)
                }))
                .sort((a, b) => {
                  // First sort by active status (active first)
                  if (a.isActive !== b.isActive) {
                    return a.isActive ? -1 : 1;
                  }
                  // Within same activity group, sort by observation count (highest first)
                  return b.observationCount - a.observationCount;
                })
                .map((operator) => {
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
                          <div className={`w-2 h-2 rounded-full ${operator.activityStatus.color}`}></div>
                          <span className="font-medium text-sm">{operator.name}</span>
                        </div>
                        <Badge variant={operator.isActive ? "default" : "secondary"} className="text-xs">
                          {operator.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {operator.observationCount > 0 ? `${operator.observationCount} observations` : operator.activityStatus.text}
                      </div>
                    </div>
                  );
                })}
            </CardContent>
          </Card>
        </div>

        {/* Operator Details */}
        <div className="lg:col-span-2">
          {selectedOperator ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{selectedOperator.name} Settings</span>
                  <div className="flex items-center space-x-2">
                    <Activity className="h-4 w-4" />
                    <span className="text-sm text-gray-600">
                      {getActivityStatus(selectedOperator).text}
                    </span>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Basic Settings */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium">Basic Information</h3>
                  
                  {/* Active Status */}
                  <div className="flex items-center justify-between">
                    <Label htmlFor="active-status" className="text-sm font-medium">
                      Active Status
                    </Label>
                    <Switch
                      id="active-status"
                      checked={selectedOperator.isActive}
                      onCheckedChange={(checked) => 
                        handleOperatorUpdate(selectedOperator.id, 'isActive', checked)
                      }
                    />
                  </div>

                  {/* Slack User ID */}
                  <div className="space-y-2">
                    <Label htmlFor="slack-id" className="text-sm font-medium">
                      Slack User ID
                    </Label>
                    <Input
                      id="slack-id"
                      placeholder="Enter Slack User ID (e.g. U1234567890)"
                      value={selectedOperator.slackUserId || ""}
                      onChange={(e) => 
                        handleOperatorUpdate(selectedOperator.id, 'slackUserId', e.target.value)
                      }
                      className="text-sm"
                    />
                    <p className="text-xs text-gray-500">
                      Find this in Slack by going to profile → More → Copy member ID
                    </p>
                  </div>
                </div>

                {/* Work Centers */}
                <div className="space-y-3">
                  <h3 className="text-lg font-medium">Work Centers</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {/* Standard work centers - always show these */}
                    {['Cutting', 'Assembly', 'Packaging', 'Rope', 'Sewing'].map((workCenter) => {
                      const hasUphData = getOperatorWorkCentersWithData(selectedOperator.name).includes(workCenter);
                      return (
                        <div key={workCenter} className="flex items-center space-x-2">
                          <Switch
                            id={`wc-${workCenter}`}
                            checked={selectedOperator.workCenters?.includes(workCenter) || false}
                            onCheckedChange={(checked) => {
                              const currentCenters = selectedOperator.workCenters || [];
                              const newCenters = checked
                                ? [...currentCenters, workCenter]
                                : currentCenters.filter(center => center !== workCenter);
                              handleOperatorUpdate(selectedOperator.id, 'workCenters', newCenters);
                            }}
                          />
                          <Label htmlFor={`wc-${workCenter}`} className="text-sm flex items-center space-x-1">
                            <span>{workCenter}</span>
                            {hasUphData && (
                              <Badge variant="secondary" className="text-xs bg-green-100 text-green-800">
                                Has Data
                              </Badge>
                            )}
                          </Label>
                        </div>
                      );
                    })}
                    {/* Additional work centers from API that aren't in the standard list */}
                    {workCenterData
                      .filter((wc: any) => !['Cutting', 'Assembly', 'Packaging', 'Rope', 'Sewing'].includes(wc.workCenter))
                      .map((wc: any) => {
                        const hasUphData = getOperatorWorkCentersWithData(selectedOperator.name).includes(wc.workCenter);
                        return (
                          <div key={wc.workCenter} className="flex items-center space-x-2">
                            <Switch
                              id={`wc-${wc.workCenter}`}
                              checked={selectedOperator.workCenters?.includes(wc.workCenter) || false}
                              onCheckedChange={(checked) => {
                                const currentCenters = selectedOperator.workCenters || [];
                                const newCenters = checked
                                  ? [...currentCenters, wc.workCenter]
                                  : currentCenters.filter(center => center !== wc.workCenter);
                                handleOperatorUpdate(selectedOperator.id, 'workCenters', newCenters);
                              }}
                            />
                            <Label htmlFor={`wc-${wc.workCenter}`} className="text-sm flex items-center space-x-1">
                              <span>{wc.workCenter}</span>
                              {hasUphData && (
                                <Badge variant="secondary" className="text-xs bg-green-100 text-green-800">
                                  Has Data
                                </Badge>
                              )}
                            </Label>
                          </div>
                        );
                      })}
                  </div>
                </div>

                {/* Product Routings */}
                <div className="space-y-3">
                  <h3 className="text-lg font-medium">Product Routings</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {routingsData?.routings?.map((routing: string) => {
                      const hasUphData = getOperatorRoutingsWithData(selectedOperator.name).includes(routing);
                      return (
                        <div key={routing} className="flex items-center space-x-2">
                          <Switch
                            id={`routing-${routing}`}
                            checked={selectedOperator.productRoutings?.includes(routing) || false}
                            onCheckedChange={(checked) => {
                              const currentRoutings = selectedOperator.productRoutings || [];
                              const newRoutings = checked
                                ? [...currentRoutings, routing]
                                : currentRoutings.filter(r => r !== routing);
                              handleOperatorUpdate(selectedOperator.id, 'productRoutings', newRoutings);
                            }}
                          />
                          <Label htmlFor={`routing-${routing}`} className="text-sm flex items-center space-x-1">
                            <span>{routing}</span>
                            {hasUphData && (
                              <Badge variant="secondary" className="text-xs bg-purple-100 text-purple-800">
                                Has Data
                              </Badge>
                            )}
                          </Label>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Activity Information */}
                {selectedOperator.lastActiveDate && (
                  <div className="space-y-2">
                    <h3 className="text-lg font-medium flex items-center">
                      <Clock className="h-4 w-4 mr-2" />
                      Activity Information
                    </h3>
                    <div className="text-sm text-gray-600">
                      Last Active: {new Date(selectedOperator.lastActiveDate).toLocaleString()}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
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
    </div>
  );
}