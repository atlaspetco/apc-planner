import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { User, Activity, Clock, Save } from "lucide-react";

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

interface OperatorCardProps {
  operator: Operator;
  availableWorkCenters: string[];
  availableOperations: string[];
  availableRoutings: string[];
  operatorCapabilities: {
    workCenters: string[];
    routings: string[];
    observationCount: number;
  };
}

export default function OperatorCard({
  operator,
  availableWorkCenters,
  availableOperations,
  availableRoutings,
  operatorCapabilities
}: OperatorCardProps) {
  const { toast } = useToast();
  const [localOperator, setLocalOperator] = useState<Operator>(operator);
  const [hasChanges, setHasChanges] = useState(false);

  // Reset local state when operator prop changes
  useEffect(() => {
    setLocalOperator(operator);
    setHasChanges(false);
  }, [operator.id, operator.isActive, operator.workCenters, operator.operations, operator.routings, operator.slackUserId]);

  const updateOperatorMutation = useMutation({
    mutationFn: async (updates: Partial<Operator>) => {
      const response = await apiRequest("PATCH", `/api/operators/${operator.id}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/operators"] });
      setHasChanges(false);
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

  const handleToggle = (field: keyof Operator, value: boolean, itemToToggle?: string) => {
    let updatedValue;
    
    if (field === 'isActive') {
      updatedValue = value;
    } else if (itemToToggle) {
      const currentArray = localOperator[field] as string[] || [];
      if (value) {
        // Add item if not already present
        updatedValue = currentArray.includes(itemToToggle) 
          ? currentArray 
          : [...currentArray, itemToToggle];
      } else {
        // Remove item
        updatedValue = currentArray.filter(item => item !== itemToToggle);
      }
    }

    setLocalOperator(prev => ({ ...prev, [field]: updatedValue }));
    setHasChanges(true);
  };

  const handleSlackUserIdChange = (value: string) => {
    setLocalOperator(prev => ({ ...prev, slackUserId: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    const updates: Partial<Operator> = {
      isActive: localOperator.isActive,
      workCenters: localOperator.workCenters,
      operations: localOperator.operations,
      routings: localOperator.routings, // Using correct database field name
      slackUserId: localOperator.slackUserId,
    };
    
    updateOperatorMutation.mutate(updates);
  };

  const getActivityStatus = () => {
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

  const activityStatus = getActivityStatus();

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center">
            <User className="h-5 w-5 mr-2" />
            {operator.name}
          </CardTitle>
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${activityStatus.color}`}></div>
            <Badge variant={operator.isActive ? "default" : "secondary"}>
              {operator.isActive ? "Active" : "Inactive"}
            </Badge>
          </div>
        </div>
        <div className="flex items-center text-sm text-gray-600 space-x-4">
          <div className="flex items-center">
            <Activity className="h-4 w-4 mr-1" />
            {operatorCapabilities.observationCount} observations
          </div>
          <div className="flex items-center">
            <Clock className="h-4 w-4 mr-1" />
            {activityStatus.text}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Basic Settings */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor={`active-${operator.id}`}>Active Status</Label>
            <Switch
              id={`active-${operator.id}`}
              checked={localOperator.isActive}
              onCheckedChange={(checked) => handleToggle('isActive', checked)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`slack-${operator.id}`}>Slack User ID</Label>
            <Input
              id={`slack-${operator.id}`}
              value={localOperator.slackUserId || ""}
              onChange={(e) => handleSlackUserIdChange(e.target.value)}
              placeholder="U1234567890"
              className="text-sm"
            />
            <p className="text-xs text-gray-500">
              Find this in Slack profile → More → Copy member ID
            </p>
          </div>
        </div>

        {/* Work Centers */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Work Centers</Label>
            <Badge variant="outline" className="text-xs">
              {localOperator.workCenters?.length || 0} selected
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {availableWorkCenters.map((workCenter) => {
              const isEnabled = localOperator.workCenters?.includes(workCenter) || false;
              const hasData = operatorCapabilities.workCenters.includes(workCenter);
              
              return (
                <div key={workCenter} className="flex items-center justify-between p-2 border rounded">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm">{workCenter}</span>
                    {hasData && <Badge variant="outline" className="text-xs bg-green-50">Has Data</Badge>}
                  </div>
                  <Switch
                    checked={isEnabled}
                    onCheckedChange={(checked) => handleToggle('workCenters', checked, workCenter)}
                    size="sm"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Operations */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Operations</Label>
            <Badge variant="outline" className="text-xs">
              {localOperator.operations?.length || 0} selected
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {availableOperations.map((operation) => {
              const isEnabled = localOperator.operations?.includes(operation) || false;
              const hasData = operatorCapabilities.operations?.includes(operation) || false;
              
              return (
                <div key={operation} className="flex items-center justify-between p-2 border rounded">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm">{operation}</span>
                    {hasData && <Badge variant="outline" className="text-xs bg-blue-50">Has Data</Badge>}
                  </div>
                  <Switch
                    checked={isEnabled}
                    onCheckedChange={(checked) => handleToggle('operations', checked, operation)}
                    size="sm"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Product Routings */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Product Routings</Label>
            <Badge variant="outline" className="text-xs">
              {localOperator.routings?.length || 0} selected
            </Badge>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {availableRoutings.map((routing) => {
              const isEnabled = localOperator.routings?.includes(routing) || false;
              const hasData = operatorCapabilities.routings.includes(routing);
              
              return (
                <div key={routing} className="flex items-center justify-between p-2 border rounded">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm">{routing}</span>
                    {hasData && <Badge className="text-xs bg-purple-100 text-purple-800">Has Data</Badge>}
                  </div>
                  <Switch
                    checked={isEnabled}
                    onCheckedChange={(checked) => handleToggle('routings', checked, routing)}
                    size="sm"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Save Button */}
        {hasChanges && (
          <Button 
            onClick={handleSave} 
            disabled={updateOperatorMutation.isPending}
            className="w-full"
          >
            <Save className="h-4 w-4 mr-2" />
            {updateOperatorMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}