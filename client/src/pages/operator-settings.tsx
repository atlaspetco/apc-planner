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
    queryKey: ["/api/uph-data"],
  });

  const handleRefresh = () => {
    refetchOperators();
    refetchWorkCenters();
    refetchRoutings();
    refetchUphData();
  };

  // Helper functions to determine auto-enabled settings based on UPH data
  const getOperatorWorkCentersWithData = (operatorName: string): string[] => {
    if (!uphData || !Array.isArray(uphData)) return [];
    
    // Find all work centers where this operator has UPH data
    const operatorUphRecords = uphData.filter((record: any) => {
      // Use correct field name from uph_data table
      return record.operatorName === operatorName || 
             (selectedOperatorData && record.operatorId === selectedOperatorData.id);
    });
    
    // Get work centers and split combined ones like "Sewing / Assembly"
    const allWorkCenters = operatorUphRecords.flatMap((record: any) => {
      const workCenter = record.workCenter;
      if (!workCenter || workCenter === 'Unknown') return [];
      
      // Split combined work centers like "Sewing / Assembly" into separate centers
      if (workCenter.includes(' / ')) {
        return workCenter.split(' / ').map((wc: string) => wc.trim());
      }
      return [workCenter];
    });
    
    return [...new Set(allWorkCenters)];
  };

  const getOperatorOperationsWithData = (operatorName: string): string[] => {
    if (!uphData || !Array.isArray(uphData)) return [];
    
    // Find all operations where this operator has UPH data
    const operatorUphRecords = uphData.filter((record: any) => {
      return record.operatorName === operatorName || 
             (selectedOperatorData && record.operatorId === selectedOperatorData.id);
    });
    
    // Extract individual operations from the operation field
    const allOperations = operatorUphRecords.flatMap((record: any) => {
      if (!record.operation) return [];
      
      // Handle operations like "Sewing / Assembly Operations" -> extract base operations
      const operation = record.operation.replace(' Operations', '');
      if (operation.includes(' / ')) {
        return operation.split(' / ').map((op: string) => op.trim());
      }
      return [operation];
    });
    
    return [...new Set(allOperations.filter(op => op && op !== 'Unknown'))];
  };

  const getOperatorRoutingsWithData = (operatorName: string): string[] => {
    if (!uphData || !Array.isArray(uphData)) {
      console.log("Debug: uphData is empty or not array:", uphData);
      return [];
    }
    
    console.log("Debug: Searching for operator:", operatorName);
    console.log("Debug: Total UPH records:", uphData.length);
    
    // Find all routings where this operator has UPH data
    const operatorUphRecords = uphData.filter((record: any) => {
      const nameMatch = record.operatorName === operatorName;
      const idMatch = selectedOperatorData && record.operatorId === selectedOperatorData.id;
      
      if (nameMatch || idMatch) {
        console.log("Debug: Found matching record:", {
          operatorName: record.operatorName,
          operatorId: record.operatorId,
          routing: record.routing,
          workCenter: record.workCenter
        });
      }
      
      return nameMatch || idMatch;
    });
    
    const routings = [...new Set(operatorUphRecords.map((record: any) => record.routing).filter(r => r && r !== 'Unknown'))];
    console.log("Debug: Final routings found:", routings);
    
    return routings;
  };

  const updateOperatorMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Partial<Operator> }) => {
      const response = await apiRequest("PATCH", `/api/operators/${id}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/operators"] });
      toast({
        title: "Success",
        description: "Operator settings updated successfully",
      });
    },
    onError: () => {
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

  const handleUpdateOperator = (updates: Partial<Operator>) => {
    if (selectedOperator) {
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
              <Button
                variant="outline"
                className="w-full justify-start border-dashed"
                onClick={() => setShowAddForm(true)}
              >
                + Add New Operator
              </Button>
              
              {allOperators.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <p>No operators configured yet.</p>
                  <p className="text-sm mt-2">Click "Add New Operator" to add your first employee.</p>
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
                    {operator.lastActiveDate && (
                      <span className="text-xs text-gray-500 ml-auto">
                        {new Date(operator.lastActiveDate).toLocaleDateString()}
                      </span>
                    )}
                    {operator.isRecentlyActive && (
                      <span className="text-xs bg-green-100 text-green-700 px-1 py-0.5 rounded">Active</span>
                    )}
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
                  <CardTitle>{selectedOperatorData.name}</CardTitle>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="isActive"
                      checked={selectedOperatorData.isActive}
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
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      key={`email-${selectedOperatorData.id}`}
                      defaultValue={selectedOperatorData.email || ""}
                      onBlur={(e) => handleUpdateOperator({ email: e.target.value })}
                    />
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
                          const hasData = getOperatorWorkCentersWithData(selectedOperatorData.name).includes(wc.workCenter);
                          const isChecked = selectedOperatorData.workCenters?.includes(wc.workCenter) || hasData;
                          
                          return (
                            <div key={`${selectedOperatorData.id}-wc-${wc.workCenter}`} className="flex items-center space-x-2">
                              <Switch
                                id={`wc-${wc.workCenter}-${selectedOperatorData.id}`}
                                key={`switch-wc-${wc.workCenter}-${selectedOperatorData.id}`}
                                checked={isChecked}
                                onCheckedChange={(checked) => {
                                  const currentWorkCenters = selectedOperatorData.workCenters || [];
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
                          const operatorOperationsWithData = getOperatorOperationsWithData(selectedOperatorData.name);
                          
                          // Get all available operations from work centers
                          const allOperations = (workCenterData as any[]).flatMap((wc: any) => wc.operations);
                          
                          // Show only operations where operator has data, plus any that are manually checked
                          const relevantOperations = allOperations.filter((operation: string) => {
                            const hasData = operatorOperationsWithData.includes(operation);
                            const isManuallyChecked = selectedOperatorData.operations?.includes(operation);
                            return hasData || isManuallyChecked;
                          });
                          
                          if (relevantOperations.length === 0) {
                            return (
                              <div className="text-gray-500 text-sm">
                                No UPH data found for this operator. Performance data will auto-populate here when available.
                              </div>
                            );
                          }
                          
                          return relevantOperations.map((operation: string, index: number) => {
                            const hasData = operatorOperationsWithData.includes(operation);
                            const isChecked = selectedOperatorData.operations?.includes(operation) || hasData;
                            // Create truly unique key combining operator ID, operation, and index
                            const stableKey = `operation-${selectedOperatorData.id}-${index}-${operation.replace(/[^a-zA-Z0-9]/g, '')}`;
                            
                            return (
                              <div key={stableKey} className="flex items-center space-x-2">
                                <Switch
                                  id={`op-${operation.replace(/[^a-zA-Z0-9]/g, '')}-${selectedOperatorData.id}-${index}`}
                                  checked={isChecked}
                                  onCheckedChange={(checked) => {
                                    const currentOperations = selectedOperatorData.operations || [];
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
                        const operatorRoutingsWithData = getOperatorRoutingsWithData(selectedOperatorData.name);
                        
                        // Show all routings - both those with data and available options
                        const allPossibleRoutings = [
                          ...operatorRoutingsWithData, // Always include routings where operator has UPH data
                          ...(selectedOperatorData.routings || []), // Include manually checked routings
                          ...(routingsData?.routings || []) // Include master list routings
                        ];
                        
                        // Remove duplicates - show all routings for full transparency
                        const uniqueRoutings = [...new Set(allPossibleRoutings)];
                        const relevantRoutings = uniqueRoutings; // Show all available routings
                        
                        if (relevantRoutings.length === 0) {
                          return (
                            <div className="text-gray-500 text-sm">
                              No UPH data found for this operator. Performance data will auto-populate here when available.
                            </div>
                          );
                        }
                        
                        return relevantRoutings.map((routing: string) => {
                          const hasData = operatorRoutingsWithData.includes(routing);
                          const isChecked = selectedOperatorData.routings?.includes(routing) || hasData;
                          const stableKey = `routing-${selectedOperatorData.id}-${routing.replace(/\s+/g, '-')}`;
                          
                          return (
                            <div key={stableKey} className="flex items-center space-x-2">
                              <Switch
                                id={`rt-${routing.replace(/\s+/g, '-')}-${selectedOperatorData.id}`}
                                checked={isChecked}
                                onCheckedChange={(checked) => {
                                  const currentRoutings = selectedOperatorData.routings || [];
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
