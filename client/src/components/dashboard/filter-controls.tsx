import { RefreshCw, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface FilterControlsProps {
  statusFilter: string[];
  onStatusFilterChange: (statuses: string[]) => void;
  routingFilter: string;
  onRoutingFilterChange: (routing: string) => void;
  selectedMOs: number[];
  onRefreshData?: () => void;
}

export default function FilterControls({ 
  statusFilter, 
  onStatusFilterChange, 
  routingFilter,
  onRoutingFilterChange,
  selectedMOs,
  onRefreshData
}: FilterControlsProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const refreshMutation = useMutation({
    mutationFn: async () => {
      // Step 1: Pull new 'done' work cycles from Fulfil
      await apiRequest('POST', '/api/fulfil/import-work-cycles');
      
      // Step 2: Aggregate durations and calculate UPH
      await apiRequest('POST', '/api/fulfil/calculate-uph-from-cycles');
      
      // Step 3: Refresh production orders
      return apiRequest('GET', '/api/fulfil/current-production-orders');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/production-orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/work-orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/uph-data'] });
      toast({
        title: "Complete Refresh Successful",
        description: "Updated work cycles, calculated fresh UPH data, and refreshed production orders.",
      });
      onRefreshData?.();
    },
    onError: (error: any) => {
      toast({
        title: "Refresh Failed",
        description: error.message || "Failed to complete comprehensive refresh from Fulfil API.",
        variant: "destructive",
      });
    },
  });
  
  const handleStatusChange = (status: string) => {
    if (status === "all") {
      onStatusFilterChange([]);
    } else {
      onStatusFilterChange([status]);
    }
  };

  const currentWeek = new Date().toISOString().slice(0, 4) + "-W" + 
    String(Math.ceil((new Date().getDate() - new Date().getDay() + 1) / 7)).padStart(2, '0');

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Filters & Controls</CardTitle>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
            {refreshMutation.isPending ? 'Processing...' : 'Refresh from Fulfil'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Status Filter */}
          <div>
            <Label className="text-sm font-medium text-gray-700">MO Status</Label>
            <Select
              value={statusFilter.length === 0 ? "all" : statusFilter[0]}
              onValueChange={handleStatusChange}
            >
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="waiting">Waiting</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="done">Done</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {/* Week Filter */}
          <div>
            <Label className="text-sm font-medium text-gray-700">Planning Week</Label>
            <Input 
              type="week" 
              className="mt-2" 
              defaultValue={currentWeek}
            />
          </div>
          
          {/* Routing Filter */}
          <div>
            <Label className="text-sm font-medium text-gray-700">Product Routing</Label>
            <Select value={routingFilter} onValueChange={onRoutingFilterChange}>
              <SelectTrigger className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Routings</SelectItem>
                <SelectItem value="Lifetime Leash">Lifetime Leash</SelectItem>
                <SelectItem value="Lifetime Harness">Lifetime Harness</SelectItem>
                <SelectItem value="Lifetime Pouch">Lifetime Pouch</SelectItem>
                <SelectItem value="Lifetime Bowl">Lifetime Bowl</SelectItem>
                <SelectItem value="Lifetime Bandana">Lifetime Bandana</SelectItem>
                <SelectItem value="Fi Snap">Fi Snap</SelectItem>
                <SelectItem value="Lifetime Pro Collar">Lifetime Pro Collar</SelectItem>
                <SelectItem value="Lifetime Pro Harness">Lifetime Pro Harness</SelectItem>
                <SelectItem value="Lifetime Lite Leash">Lifetime Lite Leash</SelectItem>
                <SelectItem value="Lifetime Lite Collar">Lifetime Lite Collar</SelectItem>
                <SelectItem value="Lifetime Air Harness">Lifetime Air Harness</SelectItem>
                <SelectItem value="Lifetime Handle">Lifetime Handle</SelectItem>
                <SelectItem value="Cutting - Fabric">Cutting - Fabric</SelectItem>
                <SelectItem value="Cutting - Webbing">Cutting - Webbing</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {/* Batch Actions */}
          <div>
            <Label className="text-sm font-medium text-gray-700">Batch Actions</Label>
            <Button 
              className="w-full mt-2 bg-green-600 hover:bg-green-700"
              disabled={selectedMOs.length === 0}
              onClick={() => {
                if (selectedMOs.length > 0) {
                  toast({
                    title: "Batch Created",
                    description: `Created batch with ${selectedMOs.length} production orders`,
                  });
                }
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Batch ({selectedMOs.length})
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
