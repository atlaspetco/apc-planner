import { RefreshCw, Plus, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <div className="bg-white border rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-gray-900">Production Planner</h3>
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
        >
          <RefreshCw className={`w-4 h-4 mr-1 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
          {refreshMutation.isPending ? 'Syncing...' : 'Refresh'}
        </Button>
        
        <Button 
          size="sm"
          className="bg-green-600 hover:bg-green-700 text-white"
          onClick={async () => {
            try {
              const response = await fetch('/api/fulfil/import-real-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}'
              });
              const result = await response.json();
              console.log('Import result:', result);
              refreshMutation.mutate(); // Refresh after import
            } catch (error) {
              console.error('Import failed:', error);
            }
          }}
        >
          <Download className="w-4 h-4 mr-1" />
          Import Real Data
        </Button>
      </div>
      
      <div className="flex flex-wrap items-center gap-3">
        {/* Compact Status Filter */}
        <div className="flex items-center gap-2">
          <Label className="text-sm text-gray-600">Status:</Label>
          <Select
            value={statusFilter.length === 0 ? "all" : statusFilter[0]}
            onValueChange={handleStatusChange}
          >
            <SelectTrigger className="w-32 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Active</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="waiting">Waiting</SelectItem>
              <SelectItem value="assigned">Assigned</SelectItem>
              <SelectItem value="running">Running</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        {/* Compact Week Filter */}
        <div className="flex items-center gap-2">
          <Label className="text-sm text-gray-600">Week:</Label>
          <Input 
            type="week" 
            className="w-40 h-8" 
            defaultValue={currentWeek}
            onChange={(e) => {
              console.log('Week filter changed:', e.target.value);
            }}
          />
        </div>
        
        {/* Compact Routing Filter */}
        <div className="flex items-center gap-2">
          <Label className="text-sm text-gray-600">Routing:</Label>
          <Select value={routingFilter} onValueChange={onRoutingFilterChange}>
            <SelectTrigger className="w-32 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="lifetime-pouch">Pouch</SelectItem>
              <SelectItem value="lifetime-bowl">Bowl</SelectItem>
              <SelectItem value="lifetime-harness">Harness</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        {/* Compact Batch Actions */}
        <div className="flex items-center gap-2 ml-auto">
          <Button 
            variant="outline" 
            size="sm" 
            disabled={selectedMOs.length === 0}
            onClick={() => {
              toast({
                title: "Create Batch",
                description: `Creating batch with ${selectedMOs.length} MOs`,
              });
            }}
          >
            <Plus className="w-4 h-4 mr-1" />
            Batch ({selectedMOs.length})
          </Button>
        </div>
      </div>
    </div>
  );
}