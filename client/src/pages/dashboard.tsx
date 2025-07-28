import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Factory, AlertCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multiselect";
import ProductionGrid from "@/components/dashboard/production-grid";
import { OperatorWorkloadSummary } from "@/components/dashboard/operator-workload-summary";
import { AutoAssignControls } from "@/components/dashboard/auto-assign-controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function Dashboard() {
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [routingFilter, setRoutingFilter] = useState<string>("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCaching, setIsCaching] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);

  const { data: productionOrders = [], isLoading: isLoadingPOs, error: errorPOs, refetch: refetchPOs } = useQuery({
    queryKey: ["/api/production-orders"],
    staleTime: 0,
    gcTime: 0,
  });

  const { data: assignmentsData, isLoading: isLoadingAssignments, refetch: refetchAssignments } = useQuery({
    queryKey: ["/api/assignments"],
    staleTime: 0,
    gcTime: 0,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Fetch latest production orders (includes waiting, assigned, and running states)
      await Promise.all([refetchPOs(), refetchAssignments()]);
      console.log('Dashboard refresh completed - updated with waiting, assigned, and running MOs');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCalculateHours = async () => {
    setIsCaching(true);
    try {
      const response = await fetch('/api/assignments/cache-hours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('Cache hours completed:', result);
        // Refresh assignments to get updated cached hours
        await refetchAssignments();
      } else {
        console.error('Cache hours failed:', response.statusText);
      }
    } catch (error) {
      console.error('Cache hours error:', error);
    } finally {
      setIsCaching(false);
    }
  };

  // Filter production orders based on selected filters
  const filteredOrders = productionOrders.filter(order => {
    const statusMatch = statusFilter.length === 0 || statusFilter.includes(order.status || 'unspecified');
    const routingMatch = routingFilter === "all" || 
      (routingFilter === "unspecified" ? !order.routing : order.routing === routingFilter);
    return statusMatch && routingMatch;
  });

  // Get unique statuses and routings for filter options
  const statusesFromOrders = [...new Set(productionOrders.map(order => order.status))];
  // Order statuses correctly: Waiting, Assigned, Running
  const statusOrder = ['waiting', 'assigned', 'running'];
  const uniqueStatuses = statusOrder.filter(status => statusesFromOrders.includes(status));
  const uniqueRoutings = [...new Set(productionOrders.map(order => order.routing))];

  // Create status options with counts
  const statusOptions = uniqueStatuses.map(status => {
    const count = productionOrders.filter(order => order.status === status).length;
    return {
      value: status || 'unspecified',
      label: status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unspecified',
      count
    };
  });

  // Status indicator color  
  const statusIndicator = isLoadingPOs || isLoadingAssignments || isRefreshing ? "yellow" : errorPOs ? "red" : "green";

  // Create assignments lookup map for easy access
  const assignmentsMap = new Map();
  if (assignmentsData?.assignments) {
    assignmentsData.assignments.forEach(assignment => {
      assignmentsMap.set(assignment.workOrderId, assignment);
    });
    console.log('Assignments Map created:', { 
      totalAssignments: assignmentsData.assignments.length,
      mapSize: assignmentsMap.size,
      sampleKeys: Array.from(assignmentsMap.keys()).slice(0, 5),
      sampleEntries: Array.from(assignmentsMap.entries()).slice(0, 3)
    });
  }

  // Show error state if API calls fail
  if (errorPOs) {
    return (
      <div className="bg-gray-50 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Connection Error</h2>
          <p className="text-gray-600 mb-4">Unable to load dashboard data</p>
          <Button onClick={handleRefresh}>Try Again</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 min-h-screen">
      {/* Combined header and controls */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Left side - filters and status */}
            <div className="flex items-center space-x-6">
              
              
              <div className="flex items-center space-x-2">
                <label className="text-sm font-medium text-gray-700">Status:</label>
                <MultiSelect
                  options={statusOptions}
                  selected={statusFilter}
                  onChange={setStatusFilter}
                  placeholder="All Statuses"
                  className="w-40"
                />
              </div>
              
              <div className="flex items-center space-x-2">
                <label className="text-sm font-medium text-gray-700">Routing:</label>
                <Select value={routingFilter} onValueChange={setRoutingFilter}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {uniqueRoutings.map(routing => (
                      <SelectItem key={routing || 'unspecified'} value={routing || 'unspecified'}>
                        {routing || 'Unspecified'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="text-sm text-gray-600 border-l pl-4">
                {filteredOrders.length} of {productionOrders.length} orders
              </div>
            </div>
            
            {/* Right side - action buttons */}
            <div className="flex items-center space-x-3">
              {/* Live status indicator */}
              <div 
                className={`flex items-center space-x-2 ${errorPOs ? 'cursor-pointer hover:bg-gray-100 rounded p-1' : ''}`}
                onClick={() => errorPOs && setShowErrorDialog(true)}
              >
                <div className={`w-3 h-3 rounded-full ${
                  statusIndicator === "green" ? "bg-green-500" : 
                  statusIndicator === "yellow" ? "bg-yellow-500 animate-pulse" : 
                  "bg-red-500"
                }`}></div>
                <span className="text-sm text-gray-600">
                  {isRefreshing ? "Refreshing..." : 
                   isLoadingPOs ? "Loading..." : 
                   errorPOs ? "Error" : "Live"}
                </span>
                {errorPOs && <AlertCircle className="w-4 h-4 text-red-500" />}
              </div>
              
              {/* Refresh button */}
              <Button 
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="flex items-center space-x-2"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </Button>
              
              {/* Calculate workload hours button */}
              <Button 
                variant="outline"
                size="sm"
                onClick={handleCalculateHours}
                disabled={isCaching}
                className="flex items-center space-x-2"
                title="Calculate expected hours for all assigned work orders"
              >
                <Clock className={`w-4 h-4 ${isCaching ? 'animate-spin' : ''}`} />
                <span>Calculate Hours</span>
              </Button>
              
              {/* Auto-assign controls */}
              <AutoAssignControls />
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Operator Workload Summary */}
        <OperatorWorkloadSummary assignments={assignmentsMap} assignmentsData={assignmentsData} />
        
        <ProductionGrid 
          productionOrders={filteredOrders}
          isLoading={isLoadingPOs}
          assignments={assignmentsMap}
          onAssignmentChange={refetchAssignments}
        />
      </div>

      {/* Error Dialog */}
      <Dialog open={showErrorDialog} onOpenChange={setShowErrorDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-500" />
              Connection Error
            </DialogTitle>
            <DialogDescription>
              Unable to load production orders from the server. Please check your connection and try again.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm font-medium text-gray-700 mb-2">Error Details:</p>
              <pre className="text-xs text-gray-600 overflow-auto">
                {errorPOs ? JSON.stringify(errorPOs, null, 2) : 'Unknown error'}
              </pre>
            </div>
            
            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setShowErrorDialog(false)}>
                Close
              </Button>
              <Button onClick={() => {
                setShowErrorDialog(false);
                handleRefresh();
              }}>
                Try Again
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}