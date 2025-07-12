import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import type { Operator } from "@shared/schema";

export default function OperatorSettings() {
  const { toast } = useToast();
  const [selectedOperator, setSelectedOperator] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newOperator, setNewOperator] = useState({
    name: "",
    email: "",
    availableHours: 40,
    workCenters: [] as string[],
    operations: [] as string[],
    routings: [],
    isActive: true
  });
  
  // Local state for optimistic updates to prevent visual lag
  const [optimisticUpdates, setOptimisticUpdates] = useState<Map<number, Partial<Operator>>>(new Map());

  const { data: allOperators = [], isLoading, refetch: refetchOperators } = useQuery({
    queryKey: ["/api/operators?activeOnly=false"],
  });

  const { data: workCenterData = [], refetch: refetchWorkCenters } = useQuery({
    queryKey: ["/api/work-centers-operations"],
  });

  const { data: routingsData, refetch: refetchRoutings } = useQuery({
    queryKey: ["/api/routings"],
  });

  // Get UPH data to identify which work centers and operations have actual data
  const { data: uphData, refetch: refetchUphData } = useQuery({
    queryKey: ["/api/uph/table-data"],
  });

  const handleRefresh = () => {
    refetchOperators();
    refetchWorkCenters();
    refetchRoutings();
    refetchUphData();
  };

  // Helper functions to determine auto-enabled settings based on UPH data
  const getOperatorWorkCentersWithData = (operatorName: string): string[] => {
    if (!uphData || !uphData.routings || !Array.isArray(uphData.routings)) return [];
    
    // Flatten all work center data from the table-data structure
    const allWorkCenterRecords = uphData.routings.flatMap((routing: any) => {
      if (!routing.workCenters || !Array.isArray(routing.workCenters)) return [];
      return routing.workCenters.flatMap((wc: any) => {
        if (!wc.operators || !Array.isArray(wc.operators)) return [];
        return wc.operators.map((op: any) => ({
          operatorName: op.operatorName,
          workCenter: wc.workCenterName
        }));
      });
    });
    
    // Find all work centers where this operator has UPH data
    const operatorWorkCenters = allWorkCenterRecords
      .filter((record: any) => record.operatorName === operatorName)
      .map((record: any) => record.workCenter);
    
    return [...new Set(operatorWorkCenters)];
  };

  const getOperatorOperationsWithData = (operatorName: string): string[] => {
    if (!uphData || !uphData.routings || !Array.isArray(uphData.routings)) return [];
    
    // Since operations aren't directly tracked in historical UPH data,
    // we'll derive them from work centers that have data
    const operatorWorkCenters = getOperatorWorkCentersWithData(operatorName);
    
    // Map work centers to their typical operations
    const workCenterOperations: { [key: string]: string[] } = {
      'Assembly': ['Assembly', 'Sewing', 'Rope Assembly'],
      'Cutting': ['Cutting', 'Laser Cutting', 'Fabric Cutting', 'Webbing Cutting'],
      'Packaging': ['Packaging', 'Final Assembly', 'Quality Check']
    };
    
    const allOperations = operatorWorkCenters.flatMap(wc => 
      workCenterOperations[wc] || [wc]
    );
    
    return [...new Set(allOperations)];
  };

  const getOperatorRoutingsWithData = (operatorName: string): string[] => {
    if (!uphData || !uphData.routings) {
      console.log("Debug: uphData is empty or missing routings:", uphData);
      return [];
    }
    
    console.log("Debug: Searching for operator:", operatorName);
    console.log("Debug: Total UPH records:", uphData.routings?.length);
    
    // Find all routings where this operator has UPH data
    const operatorRoutings: string[] = [];
    
    uphData.routings.forEach((routing: any) => {
      const hasOperatorData = routing.workCenters.some((wc: any) =>
        wc.operators.some((op: any) => op.operatorName === operatorName)
      );
      
      if (hasOperatorData) {
        operatorRoutings.push(routing.routingName);
        console.log("Debug: Found matching record:", {
          operatorName: operatorName,
          operatorId: selectedOperatorData?.id,
          routing: routing.routingName,
          workCenter: routing.workCenters.map((wc: any) => wc.workCenterName).join(', ')
        });
      }
    });
    
    console.log("Debug: Final routings found:", operatorRoutings);
    return operatorRoutings;
  };

  const updateOperatorMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Partial<Operator> }) => {
      const response = await apiRequest("PATCH", `/api/operators/${id}`, updates);
      return response.json();
    },
    onSuccess: (_, { id }) => {
      // Clear optimistic updates for this operator
      setOptimisticUpdates(prev => {
        const newMap = new Map(prev);
        newMap.delete(id);
        return newMap;
      });
      
      queryClient.invalidateQueries({ queryKey: ["/api/operators"] });
      queryClient.invalidateQueries({ queryKey: ["/api/operators?activeOnly=false"] });
      toast({
        title: "Success",
        description: "Operator settings updated successfully",
      });
    },
    onError: (_, { id }) => {
      // Clear optimistic updates on error to revert to server state
      setOptimisticUpdates(prev => {
        const newMap = new Map(prev);
        newMap.delete(id);
        return newMap;
      });
      
      toast({
        title: "Error",
        description: "Failed to update operator settings",
        variant: "destructive",
      });
    },
  });

  const createOperatorMutation = useMutation({
    mutationFn: async (operatorData: typeof newOperator) => {
      const response = await apiRequest("POST", "/api/operators", operatorData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/operators"] });
      setNewOperator({
        name: "",
        email: "",
        availableHours: 40,
        workCenters: [],
        operations: [],
        routings: ["Standard"],
        isActive: true
      });
      setShowAddForm(false);
      toast({
        title: "Success",
        description: "New operator added successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add new operator",
        variant: "destructive",
      });
    },
  });

  const selectedOperatorData = allOperators.find((op: Operator) => op.id === selectedOperator);
  
  // Apply optimistic updates to the selected operator data
  const getOptimisticOperatorData = () => {
    if (!selectedOperatorData || !selectedOperator) return selectedOperatorData;
    const optimisticData = optimisticUpdates.get(selectedOperator);
    return optimisticData ? { ...selectedOperatorData, ...optimisticData } : selectedOperatorData;
  };

  const handleUpdateOperator = (updates: Partial<Operator>) => {
    if (selectedOperator) {
      // Apply optimistic update immediately
      setOptimisticUpdates(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(selectedOperator) || {};
        newMap.set(selectedOperator, { ...existing, ...updates });
        return newMap;
      });
      
      // Then perform the actual update
      updateOperatorMutation.mutate({ id: selectedOperator, updates });
    }
  };

  if (isLoading) {
    return <div className="p-6">Loading operators...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Operator Settings</h1>
          <p className="text-gray-600">Manage operator skills, work centers, and availability</p>
        </div>
        <Button onClick={handleRefresh} variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Operator List */}
        <Card>
          <CardHeader>
            <CardTitle>Operators</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {allOperators.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <p>No operators configured yet.</p>
                </div>
              )}
              
              {/* All Operators - Sorted by Last Active */}
              {(allOperators as any[])
                .sort((a: any, b: any) => {
                  // Sort by activity status first (active at top), then by last active date
                  if (a.isRecentlyActive && !b.isRecentlyActive) return -1;
                  if (!a.isRecentlyActive && b.isRecentlyActive) return 1;
                  
                  // Both same activity status, sort by last active date (most recent first)
                  const aDate = a.lastActiveDate ? new Date(a.lastActiveDate).getTime() : 0;
                  const bDate = b.lastActiveDate ? new Date(b.lastActiveDate).getTime() : 0;
                  return bDate - aDate;
                })
                .map((operator: any) => (
                <Button
                  key={operator.id}
                  variant={selectedOperator === operator.id ? "default" : "outline"}
                  className="w-full justify-start"
                  onClick={() => setSelectedOperator(operator.id)}
                >
                  <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full ${operator.isRecentlyActive ? 'bg-green-500' : 'bg-orange-400'}`} />
                    <span>{operator.name}</span>
                  </div>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Operator Details */}
        {selectedOperatorData && (
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{getOptimisticOperatorData()?.name}</CardTitle>
                    {selectedOperatorData.lastActiveDate && (
                      <p className="text-sm text-gray-500 mt-1">
                        Last active: {new Date(selectedOperatorData.lastActiveDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="isActive"
                      checked={getOptimisticOperatorData()?.isActive || false}
                      onCheckedChange={(checked) => handleUpdateOperator({ isActive: checked })}
                    />
                    <Label htmlFor="isActive">Active</Label>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="name">Name</Label>
                    <Input
                      id="name"
                      key={`name-${selectedOperatorData.id}`}
                      defaultValue={selectedOperatorData.name}
                      onBlur={(e) => handleUpdateOperator({ name: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="slackUserId">Slack User ID</Label>
                    <Input
                      id="slackUserId"
                      type="text"
                      placeholder="U1234567890"
                      key={`slackUserId-${selectedOperatorData.id}`}
                      defaultValue={selectedOperatorData.slackUserId || ""}
                      onBlur={(e) => handleUpdateOperator({ slackUserId: e.target.value })}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Find Slack User ID: In Slack, click on user profile → More → Copy member ID
                    </p>
                  </div>
                </div>

                {/* Availability */}
                <div>
                  <Label htmlFor="availableHours">Available Hours per Week</Label>
                  <Input
                    id="availableHours"
                    type="number"
                    min="0"
                    max="60"
                    key={`hours-${selectedOperatorData.id}`}
                    defaultValue={selectedOperatorData.availableHours}
                    onBlur={(e) => handleUpdateOperator({ availableHours: parseInt(e.target.value) })}
                  />
                </div>

                {/* UPH Calculation Window */}
                <div>
                  <Label htmlFor="uphWindow">UPH Calculation Window (days)</Label>
                  <Select
                    defaultValue={selectedOperatorData.uphCalculationWindow?.toString()}
                    onValueChange={(value) => handleUpdateOperator({ uphCalculationWindow: parseInt(value) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 day</SelectItem>
                      <SelectItem value="5">5 days</SelectItem>
                      <SelectItem value="10">10 days</SelectItem>
                      <SelectItem value="30">30 days</SelectItem>
                      <SelectItem value="90">90 days</SelectItem>
                      <SelectItem value="180">180 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Two Column Layout: Work Centers/Operations + Product Routings */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Left Column: Work Centers + Operations */}
                  <div className="space-y-6">
                    {/* Work Centers */}
                    <div>
                      <Label>Work Centers</Label>
                      <div className="mt-2 space-y-2">
                        {(workCenterData as any[]).map((wc: any) => {
                          const optimisticData = getOptimisticOperatorData();
                          const hasData = getOperatorWorkCentersWithData(optimisticData?.name || '').includes(wc.workCenter);
                          const isChecked = optimisticData?.workCenters?.includes(wc.workCenter) || hasData;
                          
                          return (
                            <div key={`${selectedOperatorData.id}-wc-${wc.workCenter}`} className="flex items-center space-x-2">
                              <Switch
                                id={`wc-${wc.workCenter}-${selectedOperatorData.id}`}
                                key={`switch-wc-${wc.workCenter}-${selectedOperatorData.id}`}
                                checked={isChecked}
                                onCheckedChange={(checked) => {
                                  const optimisticData = getOptimisticOperatorData();
                                  const currentWorkCenters = optimisticData?.workCenters || [];
                                  const newWorkCenters = checked
                                    ? [...currentWorkCenters, wc.workCenter]
                                    : currentWorkCenters.filter((center: string) => center !== wc.workCenter);
                                  handleUpdateOperator({ workCenters: newWorkCenters });
                                }}
                              />
                              <Label htmlFor={`wc-${wc.workCenter}-${selectedOperatorData.id}`} className="flex items-center space-x-2">
                                <span>{wc.workCenter}</span>
                                {hasData && (
                                  <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Has Data</span>
                                )}
                              </Label>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Operations */}
                    <div>
                      <Label>Operations</Label>
                      <div className="mt-2 space-y-2">
                        {(() => {
                          // Get operations where this operator has data
                          const optimisticData = getOptimisticOperatorData();
                          const operatorOperationsWithData = getOperatorOperationsWithData(optimisticData?.name || '');
                          
                          // Get all available operations from work centers - SHOW ALL OPERATIONS
                          const allOperations = (workCenterData as any[]).flatMap((wc: any) => wc.operations);
                          const uniqueOperations = [...new Set(allOperations)];
                          
                          // Show ALL operations available in the system, not just ones with data
                          const relevantOperations = uniqueOperations;
                          
                          if (relevantOperations.length === 0) {
                            return (
                              <div className="text-gray-500 text-sm">
                                No operations configured in the system.
                              </div>
                            );
                          }
                          
                          return relevantOperations.map((operation: string, index: number) => {
                            const hasData = operatorOperationsWithData.includes(operation);
                            const optimisticData = getOptimisticOperatorData();
                            const isChecked = optimisticData?.operations?.includes(operation) || hasData;
                            // Create truly unique key combining operator ID, operation, and index
                            const stableKey = `operation-${selectedOperatorData.id}-${index}-${operation.replace(/[^a-zA-Z0-9]/g, '')}`;
                            
                            return (
                              <div key={stableKey} className="flex items-center space-x-2">
                                <Switch
                                  id={`op-${operation.replace(/[^a-zA-Z0-9]/g, '')}-${selectedOperatorData.id}-${index}`}
                                  checked={isChecked}
                                  onCheckedChange={(checked) => {
                                    const optimisticData = getOptimisticOperatorData();
                                    const currentOperations = optimisticData?.operations || [];
                                    const newOperations = checked
                                      ? [...currentOperations, operation]
                                      : currentOperations.filter((op: string) => op !== operation);
                                    handleUpdateOperator({ operations: newOperations });
                                  }}
                                />
                                <Label htmlFor={`op-${operation.replace(/[^a-zA-Z0-9]/g, '')}-${selectedOperatorData.id}-${index}`} className="flex items-center space-x-2">
                                  <span className="text-sm">{operation}</span>
                                  {hasData && (
                                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">Has Data</span>
                                  )}
                                </Label>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Product Routings */}
                  <div>
                    <Label>Product Routings</Label>
                    <div className="mt-2 space-y-2">
                      {(() => {
                        // Get routings where this operator has data
                        const optimisticData = getOptimisticOperatorData();
                        const operatorRoutingsWithData = getOperatorRoutingsWithData(optimisticData?.name || '');
                        
                        // Show ALL routings available in system - both with data and master list
                        const allPossibleRoutings = [
                          ...operatorRoutingsWithData, // Include routings where operator has UPH data
                          ...(optimisticData?.routings || []), // Include manually checked routings
                          ...(routingsData?.routings || []) // Include master list routings
                        ];
                        
                        // Remove duplicates and show ALL routings for complete transparency
                        const uniqueRoutings = [...new Set(allPossibleRoutings)];
                        const relevantRoutings = uniqueRoutings.length > 0 ? uniqueRoutings : routingsData?.routings || [];
                        
                        if (relevantRoutings.length === 0) {
                          return (
                            <div className="text-gray-500 text-sm">
                              No UPH data found for this operator. Performance data will auto-populate here when available.
                            </div>
                          );
                        }
                        
                        return relevantRoutings.map((routing: string) => {
                          const hasData = operatorRoutingsWithData.includes(routing);
                          const optimisticData = getOptimisticOperatorData();
                          const isChecked = optimisticData?.routings?.includes(routing) || hasData;
                          const stableKey = `routing-${selectedOperatorData.id}-${routing.replace(/\s+/g, '-')}`;
                          
                          return (
                            <div key={stableKey} className="flex items-center space-x-2">
                              <Switch
                                id={`rt-${routing.replace(/\s+/g, '-')}-${selectedOperatorData.id}`}
                                checked={isChecked}
                                onCheckedChange={(checked) => {
                                  const optimisticData = getOptimisticOperatorData();
                                  const currentRoutings = optimisticData?.routings || [];
                                  const newRoutings = checked
                                    ? [...currentRoutings, routing]
                                    : currentRoutings.filter((rt: string) => rt !== routing);
                                  handleUpdateOperator({ routings: newRoutings });
                                }}
                              />
                              <Label htmlFor={`rt-${routing.replace(/\s+/g, '-')}-${selectedOperatorData.id}`} className="flex items-center space-x-2">
                                <span className="text-sm">{routing}</span>
                                {hasData && (
                                  <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded">Has Data</span>
                                )}
                              </Label>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
